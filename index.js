import { createRequire } from 'node:module'
import { realpathSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createClient, listOrganizations } from './server/yunxiao.js'
import { PACKAGE, compareVersions, desktopCliCandidates, fetchLatest, isLocalSpec, readDependencySpec, readVersion, resolveProfile } from './server/version.js'

// ponytail: linked workspace cannot resolve dsh's own packages; resolve from the dsh entry instead.
// Must import() (not require()): host loads plugins via Promise.all, require(esm) races and throws ERR_REQUIRE_ESM_RACE_CONDITION.
function hostResolve(spec) {
  try {
    return createRequire(import.meta.url).resolve(spec)
  } catch {}
  if (!process.argv[1]) throw new Error('找不到 dsh 安装目录')
  return createRequire(realpathSync(process.argv[1])).resolve(spec)
}
const { defineTool } = await import(pathToFileURL(hostResolve('@deepseek-ai/dsh-tools')))
const schema = await import(pathToFileURL(hostResolve('@deepseek-ai/schemastery')))
const z = schema.z ?? schema.default ?? schema

export const inject = ['tools', 'webServer']
export const Config = z.object({
  token: z.string().role('secret').default(''),
  organizationId: z.string().default(''),
  baseUrl: z.string().default(''),
  edition: z.union([z.const('center'), z.const('region'), z.const('')]).default(''),
})

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {})
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

function send(res, payload) {
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(payload))
}

// 插件行没有通用配置表单，这里自带可编辑设置：保存值 > 插件配置 > 环境变量
const HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const STORE = join(HOME, 'yunxiao-taskboard.json')
const FIELDS = ['token', 'organizationId', 'baseUrl', 'edition']

const PACKAGE_FILE = fileURLToPath(new URL('./package.json', import.meta.url))
// 进程加载时的代码版本：磁盘版本更高说明已升级但还没重启，前端据此提示「重启生效」
const loadedVersion = readVersion(PACKAGE_FILE)
// CLI 升级需要 profile；识别不到就不提供升级入口，免得改错 profile
const profile = resolveProfile()
const isDesktop = Boolean(process.versions.electron) || process.env.ELECTRON_RUN_AS_NODE !== undefined
// 桌面端用自带 CLI 管理 desktop profile（普通 dsh CLI 会拒绝 desktop profile）
const desktopCli = isDesktop ? desktopCliCandidates().find((file) => existsSync(file)) || '' : ''

// 用当前 dsh 入口拉起 CLI（子系统 PATH 里未必有 dsh），找不到再退回裸命令
function dshEntry() {
  try {
    const entry = realpathSync(process.argv[1])
    return /[\\/]bin\.js$/.test(entry) ? entry : ''
  } catch {
    return ''
  }
}

function runPluginCommand(args, timeoutMs = 180_000) {
  return new Promise((resolve) => {
    const entry = desktopCli ? '' : dshEntry()
    const command = desktopCli || (entry ? process.execPath : 'dsh')
    const argv = [...(desktopCli ? [] : entry ? [entry] : []), 'plugin', '--profile', profile, ...args]
    const child = spawn(command, argv, {
      stdio: ['ignore', 'pipe', 'pipe'],
      // .cmd 包装脚本必须过 shell；web 端 PATH 里没有 dsh 时也走 shell
      shell: process.platform === 'win32' && (desktopCli ? /\.(cmd|bat)$/i.test(desktopCli) : !entry),
    })
    let output = ''
    const collect = (chunk) => { output = (output + String(chunk)).slice(-4000) }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)
    const timer = setTimeout(() => {
      child.kill()
      // 被杀进程不保证再触发 close，这里主动结算，避免升级入口永久卡在「升级中」
      resolve({ ok: false, output: `${output}\n升级命令执行超时` })
    }, timeoutMs)
    child.once('error', (error) => {
      clearTimeout(timer)
      resolve({ ok: false, output: `${output}\n${error.message}` })
    })
    // close 而非 exit：等 stdio 排空，否则失败时最后一段 pnpm 错误可能丢
    child.once('close', (code) => {
      clearTimeout(timer)
      resolve({ ok: code === 0, output })
    })
  })
}

function readStore() {
  try {
    const saved = JSON.parse(readFileSync(STORE, 'utf8'))
    return Object.fromEntries(FIELDS.filter((key) => typeof saved[key] === 'string').map((key) => [key, saved[key]]))
  } catch {
    return {}
  }
}

export function apply(ctx, config) {
  let overrides = readStore()
  // 空字符串表示「不覆盖」，退回插件配置/环境变量，避免清空设置后连接直接失效
  const effective = () => {
    const merged = { ...config }
    for (const [key, value] of Object.entries(overrides)) {
      if (typeof value === 'string' && value.trim()) merged[key] = value
    }
    return merged
  }
  const client = (orgId) => createClient(
    orgId ? { ...effective(), organizationId: orgId } : effective(),
    { fetch: globalThis.fetch },
  )
  let latestCheck = { at: 0, version: '' }
  async function latestVersion(force = false) {
    if (!force && latestCheck.version && Date.now() - latestCheck.at < 10 * 60 * 1000) return latestCheck.version
    const version = await fetchLatest()
    if (version) latestCheck = { at: Date.now(), version }
    return version
  }

  let updating = null
  function updatePlugin() {
    if (updating) return updating
    updating = upgrade().finally(() => { updating = null })
    return updating
  }

  async function upgrade() {
    if (!profile) throw new Error('识别不到当前 DSH profile，请手动升级')
    if (isDesktop && !desktopCli) throw new Error('找不到桌面版 CLI，请在 DSH Desktop 的插件页升级')
    // 点升级时重查一次，避免发完新版本还拿缓存说不更新；网络抖动则退回上次结果
    const target = (await latestVersion(true)) || latestCheck.version
    if (!target) throw new Error('读取 npm 最新版本失败，请检查网络')
    if (compareVersions(target, readVersion(PACKAGE_FILE)) <= 0) throw new Error('已经是最新版本')
    // pnpm 的 minimumReleaseAge 会推迟新发布版本，显式装精确版本才装得上
    const result = await runPluginCommand(['add', `${PACKAGE}@${target}`, '-w'])
    if (!result.ok) {
      const detail = result.output.split('\n').map((line) => line.trim()).filter(Boolean).slice(-2).join(' ')
      throw new Error(detail || '升级命令执行失败')
    }
    return { version: target }
  }

  const methods = {
    version: async () => {
      const current = readVersion(PACKAGE_FILE)
      const latest = await latestVersion()
      // link/file 安装也能升，只是会把开发链接换成 npm 版本（前端在 title 里提示）
      const local = profile ? isLocalSpec(readDependencySpec(join(HOME, 'profiles', profile, 'package.json'))) : false
      return {
        current,
        latest,
        linked: local,
        // 磁盘版本 > 进程启动时的版本 = 已升级未重启
        pendingRestart: Boolean(current) && compareVersions(current, loadedVersion) > 0,
        updateAvailable: Boolean(latest) && compareVersions(latest, current) > 0,
        canUpdate: Boolean(profile) && (!isDesktop || Boolean(desktopCli)),
      }
    },
    update: () => updatePlugin(),
    settings: () => ({
      token: '',
      hasToken: Boolean(effective().token || process.env.YUNXIAO_API_KEY),
      organizationId: effective().organizationId || '',
      baseUrl: effective().baseUrl || '',
      edition: effective().edition || '',
      store: STORE,
    }),
    saveSettings: (input) => {
      const next = { ...overrides }
      for (const key of FIELDS) {
        if (typeof input?.[key] !== 'string') continue
        const value = input[key].trim()
        if (key === 'token' && value === '') continue
        next[key] = value
      }
      overrides = next
      mkdirSync(dirname(STORE), { recursive: true })
      writeFileSync(STORE, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
      return methods.settings()
    },
    // 令牌没有组织管理读权限时列表读不到，退化成「只有当前组织」仍可正常用
    organizations: async () => {
      const current = effective()
      let organizations = []
      let error = null
      try {
        organizations = await listOrganizations(current, { fetch: globalThis.fetch })
      } catch (err) {
        error = err?.message || '读取组织列表失败'
      }
      const organizationId = current.organizationId || ''
      if (organizationId && !organizations.some((org) => org.id === organizationId)) {
        organizations = [{ id: organizationId, name: organizationId }, ...organizations]
      }
      return { organizations, organizationId, edition: current.edition || '', error }
    },
    projects: (orgId) => client(orgId).projects(),
    board: async (query) => {
      const { orgId, ...rest } = query ?? {}
      const board = await client(orgId).board(rest)
      return { ...board, orgId: orgId || effective().organizationId || '' }
    },
    column: (query) => {
      const { orgId, ...rest } = query ?? {}
      return client(orgId).column(rest)
    },
    detail: (args) => {
      const { id, orgId } = typeof args === 'string' ? { id: args } : (args ?? {})
      return client(orgId).detail(id)
    },
    transitions: (args) => {
      const { id, orgId } = typeof args === 'string' ? { id: args } : (args ?? {})
      return client(orgId).transitions(id)
    },
    transition: (input) => client(input?.orgId).transition(input),
    comment: (input) => client(input?.orgId).comment(input),
    projectMembers: ({ spaceId, orgId } = {}) => client(orgId).projectMembers(spaceId),
    workitemTypes: ({ spaceId, category, orgId } = {}) => client(orgId).workitemTypes(spaceId, category),
    createWorkitem: (input) => client(input?.orgId).createWorkitem(input),
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/api/yunxiao-taskboard',
    async handler(req, res) {
      if (req.method !== 'POST') {
        send(res, { ok: false, error: '只支持 POST' })
        return
      }
      try {
        const body = await readJson(req)
        // 安装类操作要求自定义头：跨域页面只能发简单请求，带不上自定义头，预检会被浏览器拦掉
        if (body?.method === 'update' && req.headers['x-dsh-taskboard-action'] !== 'update') {
          throw new Error('缺少升级请求标记')
        }
        const method = methods[body?.method]
        if (!method) throw new Error('未知方法')
        send(res, { ok: true, value: await method(body.args) })
      } catch (error) {
        send(res, { ok: false, error: error?.message || '请求失败' })
      }
    },
  }), 'yunxiao: board rpc')

  ctx.tools.register(defineTool({
    name: 'yunxiao_workitems',
    description: 'Read Yunxiao projects, work items, or status lists. This is the native Yunxiao tool: prefer it over curl or the yunxiao-dev skill. action=detail reads one work item (description HTML, images, attachments) by id/serial; action=search lists board columns. Call transitions before changing a status. Do not guess status names. For `action=project_members`, list selectable project members. For `action=workitem_types`, list enabled types for the project/category. For `action=create`, require explicit `workitemTypeId` from the user and `assignedTo`; query types and members first rather than guessing.',
    parameters: {
      action: { type: 'string', required: true, enum: ['projects', 'search', 'detail', 'transitions', 'project_members', 'workitem_types', 'create'] },
      spaceId: { type: 'string' },
      orgId: { type: 'string' },
      category: { type: 'string', enum: ['Req', 'Bug'] },
      subject: { type: 'string' },
      description: { type: 'string' },
      assignedTo: { type: 'string', description: 'Selected project member userId; never invent one' },
      workitemTypeId: { type: 'string', description: 'Explicit selected type identifier from yunxiao_workitem_types' },
      q: { type: 'string' },
      priority: { type: 'string', enum: ['urgent', 'high', 'medium', 'low'] },
      id: { type: 'string', description: 'Work item id or serial number such as EVXU-1095' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] },
    async execute(args) {
      if (args.action === 'projects') return { projects: await methods.projects(args.orgId) }
      if (args.action === 'project_members') return { members: await methods.projectMembers({ spaceId: args.spaceId, orgId: args.orgId }) }
      if (args.action === 'workitem_types') return { types: await methods.workitemTypes({ spaceId: args.spaceId, category: args.category, orgId: args.orgId }) }
      if (args.action === 'create') return methods.createWorkitem(args)
      if (args.action === 'detail') return methods.detail({ id: args.id, orgId: args.orgId })
      if (args.action === 'transitions') return { statuses: await methods.transitions({ id: args.id, orgId: args.orgId }) }
      return methods.board({ spaceId: args.spaceId, category: args.category ?? 'Req', q: args.q, priority: args.priority, orgId: args.orgId })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'yunxiao_project_members',
    description: 'List selectable Yunxiao project members. Use before creating a requirement or defect and ask the user to choose a member; never guess a userId.',
    parameters: {
      spaceId: { type: 'string', required: true },
      orgId: { type: 'string' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] },
    execute: (args) => methods.projectMembers(args),
  }))

  ctx.tools.register(defineTool({
    name: 'yunxiao_workitem_types',
    description: 'List enabled workitem types for a Yunxiao project and Req/Bug category. Query this first and ask the user to choose a type before creating a work item.',
    parameters: {
      spaceId: { type: 'string', required: true },
      category: { type: 'string', required: true, enum: ['Req', 'Bug'] },
      orgId: { type: 'string' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] },
    execute: async (args) => ({ types: await methods.workitemTypes(args) }),
  }))

  ctx.tools.register(defineTool({
    name: 'yunxiao_create_workitem',
    description: 'Create a Yunxiao requirement or defect. assignedTo is mandatory: call yunxiao_project_members first, ask the user which member to assign, then pass that member userId. Never invent a default assignee. workitemTypeId is mandatory: query yunxiao_workitem_types first and pass the type identifier explicitly selected by the user. No attachments are supported yet.',
    parameters: {
      spaceId: { type: 'string', required: true },
      category: { type: 'string', required: true, enum: ['Req', 'Bug'] },
      subject: { type: 'string', required: true },
      description: { type: 'string' },
      assignedTo: { type: 'string', required: true, description: 'userId of the explicitly selected project member' },
      workitemTypeId: { type: 'string', required: true, description: 'Identifier of the type explicitly selected by the user from yunxiao_workitem_types' },
      orgId: { type: 'string' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] },
    execute: (args) => methods.createWorkitem(args),
  }))

  ctx.tools.register(defineTool({
    name: 'yunxiao_comment',
    description: 'Archive a change onto a Yunxiao requirement/bug: post a Markdown comment into its comment list and link the Codeup commits that were pushed. This is the native Yunxiao tool for change history - call it after each meaningful change while developing a work item, and after a git push pass the pushed commits. `content` is the change record (what changed, why, how it was verified). Commit entries are appended to the comment and associated to the work item; the Codeup repository id is resolved from a commit page `url`, so `projectId` is only needed when the url cannot be resolved. Partial commit-association failures do not fail the comment. 403 means the token has no write permission.',
    parameters: {
      id: { type: 'string', required: true, description: 'Work item id or serial number such as EVXU-1095' },
      content: { type: 'string', required: true, description: 'Markdown change record: what changed, why, and how it was verified' },
      commits: {
        type: 'array',
        description: 'Codeup commits pushed for this change; each one is linked to the work item',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            sha: { type: 'string', required: true, description: 'Commit SHA' },
            title: { type: 'string', description: 'Commit subject' },
            url: { type: 'string', description: 'Codeup commit page URL, used to resolve the repository id' },
            projectId: { type: 'string', description: 'Codeup repository id; optional when url resolves it' },
          },
        },
      },
      projectId: { type: 'string', description: 'Default Codeup repository id for all commits' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] },
    execute: (args) => methods.comment(args),
  }))

  ctx.tools.register(defineTool({
    name: 'yunxiao_transition',
    description: 'Move a Yunxiao work item to a status. This is the native Yunxiao write tool: prefer it over curl. Prefer `phase`: start (需求→开发中, 缺陷→处理中) when beginning development, pushed (需求→测试中, 缺陷→已修复) after the commit is pushed. `status` takes an exact status name or id. 403 means the token has no write permission.',
    parameters: {
      id: { type: 'string', required: true },
      phase: { type: 'string', enum: ['start', 'pushed'], description: 'Development phase to map onto the category status.' },
      status: { type: 'string', description: 'Explicit status name or id; used when phase is omitted.' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] },
    execute: (args) => methods.transition(args),
  }))
}
