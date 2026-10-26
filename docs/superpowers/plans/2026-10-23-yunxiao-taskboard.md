# 云效需求与缺陷进度面板 Implementation Plan

> **实现备注（落地后修订，以本文件下方"实施偏差"为准）**

## 实施偏差

1. **Client 取数不走 `ctx.remote`**。Client 的 `remote.*` 命名空间来自生成的 typert 描述符，随包发布的插件才有；本地插件拿不到。改为 Host 用 `webServer.register({ kind: 'prefix', path: '/yunxiao' })` 暴露一个 POST 路由，Client 用 `fetch('/yunxiao', { method:'POST', body:{ method, args } })` 调用。令牌仍只在 Host。
2. **`conditions` 里同组是 AND，跨组是 OR**。阶段和关键词必须放在同一个 `conditionGroups` 组内，否则结果是并集。
3. **编号查找用 `serialNumber` + `CONTAINS`**，不需要按标题猜；搜索框输入编号时直接解析唯 id 再取详情，不依赖标题包含编号。
4. **Host 依赖（`dsh-tools`、`schemastery`）从 dsh 入口解析**。链接的工作区目录解析不到 dsh 自带包，`createRequire(realpathSync(process.argv[1]))` 兜底。
5. 令牌写在 profile 的 `cordis.patch.yml` 里（与 `~/.zshrc` 同一枚令牌，本地明文）。若要改成设置页填写，把该行删掉后在插件设置里填。
6. **详情**：点卡片调 Host `detail(id)`，抽屉里显示状态/负责人/创建人/类型/项目/创建时间/更新时间/描述。描述的富文本信封有时以 JSON 字符串返回，需先解析再取 `htmlValue`，最后剥标签转纯文本（不渲染 HTML）。
7. **待处理卡片可派到工作区**：卡片多一个「处理」按钮，展开工作区下拉（`ctx.workspaces.list.getSnapshot().items`），选中后 `ctx.uiWorkspace.startSession(workspaceId, { prompt })`，草稿预填「处理云效需求/缺陷 <编号>：<标题>」。Client 插件因此 `inject: ['slots', 'workspaces', 'uiWorkspace']`。
8. **详情按原格式渲染**：Host 额外返回 `descriptionHtml`（富文本原文）和 `attachments`（`GET /workitems/{id}/attachments`）。Client 用 DOMParser 白名单消毒后 `dangerouslySetInnerHTML`：保留 p/div/span/table/img/a 等排版标签与 `style`，删掉 script/style/iframe 等节点与 `on*` 属性，`href`/`src` 只允许 http(s) 与相对路径。
9. **图片只在弹层预览，不需要网页登录**：描述里的 `<img>` 原本指向 `https://devops.aliyun.com/projex/api/workitem/file/url?fileIdentifier=…`，只认网页登录态。Host 在 `detail` 里把每个 fileIdentifier 换成 OpenAPI 换出来的 OSS 直链：`GET {root}/workitems/{id}/files/{fileIdentifier}` 取 `url`（可匿名访问），再把 HTML 里的旧地址替换掉。附件也用同一个接口取真实地址和大小。
10. **点图不跳转、不下载**：点击弹层按 94vw/92vh 等比显示，点遮罩 / 点 × / Esc 关闭（Esc 先关预览再关抽屉）。换取失败时保留原地址，图片加载失败就整块替换成纯文本提示，不留可下载入口。


> **For agentic workers:** 实现时按任务顺序做。步骤用 `- [ ]` 勾选。设计规格：`docs/superpowers/specs/2026-10-23-yunxiao-taskboard-design.md`。

**Goal:** 做一个 Harness 插件，读阿里云云效的需求和缺陷，按状态分栏展示，并允许人和 AI 流转工作项状态。

**Architecture:** Host 插件持有连接配置并请求云效。Client 只渲染看板，通过 Host Service 的 Remote 方法取数和流转。AI 工具调用同一套方法。

**Tech Stack:** Node 内置 `fetch`、`node:test`、Harness 插件（`defineTool`、`Service`、`sidebar.panellist` + `main`）。不新增 npm 依赖。

## Global Constraints

- 令牌只留在 Host。不进 Client、不进工具结果、不进日志。
- 配置优先：插件 Config 非空字符串 > 环境变量 > 默认值。空字符串视为未填。
- 中心版路径带 `/organizations/{org}`。Region 版不带。`edition=region`，或未填 edition 且组织 ID 为空，走 Region。
- 环境变量：`YUNXIAO_API_KEY`、`YUNXIAO_ORG_ID`、`YUNXIAO_API_BASE_URL`。baseUrl 默认 `https://openapi-rdc.aliyuncs.com`。
- 唯一写入是状态流转，body 只有 `{"status":"<statusId>"}`。
- 不创建、不改标题、不改描述、不改负责人。
- 已结束栏（阶段 4、5）默认不请求。
- 测试不打真实云效。用注入的 `fetch`。
- 当前令牌对 PUT 返回 403。不要用它做真实流转验证。

## 文件

| 文件 | 职责 |
| --- | --- |
| `package.json` | 插件包清单 |
| `cordis.patch.yml` | 插入一行插件 |
| `locale/zh.json` `locale/en.json` | 插件标题和描述 |
| `icon.svg` | 侧边栏图标 |
| `server/config.js` | 配置解析、路径选择 |
| `server/board.js` | 阶段到栏、查询体、状态名匹配 |
| `server/yunxiao.js` | 云效 HTTP |
| `index.js` | Host：Service、工具、`apply` |
| `client.js` | 看板 |
| `test/yunxiao.test.js` | 不打真接口的测试 |

## Task 1: 配置解析与路径

**Files:**
- Create: `server/config.js`
- Test: `test/yunxiao.test.js`

- [ ] **Step 1: 写失败测试**

`test/yunxiao.test.js`：

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveConnection } from '../server/config.js'

const env = {
  YUNXIAO_API_KEY: 'env-token',
  YUNXIAO_ORG_ID: 'env-org',
  YUNXIAO_API_BASE_URL: 'https://env.example',
}

test('plugin token and org win over env', () => {
  const c = resolveConnection({ token: 'cfg', organizationId: 'org' }, env)
  assert.equal(c.token, 'cfg')
  assert.equal(c.organizationId, 'org')
  assert.equal(c.edition, 'center')
  assert.equal(c.workitemsSearch, 'https://openapi-rdc.aliyuncs.com/oapi/v1/projex/organizations/org/workitems:search')
})

test('empty plugin values fall back to env', () => {
  const c = resolveConnection({ token: '  ', organizationId: '' }, env)
  assert.equal(c.token, 'env-token')
  assert.equal(c.organizationId, 'env-org')
  assert.equal(c.baseUrl, 'https://env.example')
})

test('region omits organization segment', () => {
  const c = resolveConnection({ token: 'cfg', edition: 'region', baseUrl: 'https://org.devops.aliyuncs.com/' }, {})
  assert.equal(c.edition, 'region')
  assert.equal(c.workitemsSearch, 'https://org.devops.aliyuncs.com/oapi/v1/projex/workitems:search')
  assert.equal(c.workflow('abc'), 'https://org.devops.aliyuncs.com/oapi/v1/projex/workitems/abc/workflow')
  assert.equal(c.workitem('abc'), 'https://org.devops.aliyuncs.com/oapi/v1/projex/workitems/abc')
})

test('missing org on center is an error, region is not', () => {
  assert.throws(() => resolveConnection({ token: 'cfg', edition: 'center' }, {}), /组织 ID/)
  const region = resolveConnection({ token: 'cfg', edition: 'region' }, {})
  assert.equal(region.organizationId, '')
})

test('missing token is an error', () => {
  assert.throws(() => resolveConnection({}, {}), /令牌/)
})
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `node --test test/yunxiao.test.js`
Expected: FAIL，找不到 `../server/config.js`。

- [ ] **Step 3: 实现 `server/config.js`**

```js
const DEFAULT_BASE = 'https://openapi-rdc.aliyuncs.com'

function pick(configValue, envValue) {
  const fromConfig = typeof configValue === 'string' ? configValue.trim() : ''
  if (fromConfig) return fromConfig
  return typeof envValue === 'string' ? envValue.trim() : ''
}

export function resolveConnection(config = {}, env = process.env) {
  const token = pick(config.token, env.YUNXIAO_API_KEY)
  if (!token) throw new Error('未配置云效令牌')
  const organizationId = pick(config.organizationId, env.YUNXIAO_ORG_ID)
  const edition = pick(config.edition, '') || (organizationId ? 'center' : 'region')
  if (edition !== 'center' && edition !== 'region') throw new Error('edition 只能是 center 或 region')
  if (edition === 'center' && !organizationId) throw new Error('未配置组织 ID')
  const baseUrl = (pick(config.baseUrl, env.YUNXIAO_API_BASE_URL) || DEFAULT_BASE).replace(/\/+$/, '')
  const root = edition === 'center'
    ? `${baseUrl}/oapi/v1/projex/organizations/${encodeURIComponent(organizationId)}`
    : `${baseUrl}/oapi/v1/projex`
  return {
    token,
    organizationId,
    edition,
    baseUrl,
    projectsSearch: `${root}/projects:search`,
    workitemsSearch: `${root}/workitems:search`,
    workitem: (id) => `${root}/workitems/${encodeURIComponent(id)}`,
    workflow: (id) => `${root}/workitems/${encodeURIComponent(id)}/workflow`,
  }
}
```

- [ ] **Step 4: 跑测试，确认通过**

Run: `node --test test/yunxiao.test.js`
Expected: PASS。

## Task 2: 栏映射、查询体、状态名匹配

**Files:**
- Create: `server/board.js`
- Modify: `test/yunxiao.test.js`

- [ ] **Step 1: 追加失败测试**

```js
import { columnsFor, searchBody, matchStatus } from '../server/board.js'

test('req columns keep open stages and hide closed by default', () => {
  assert.deepEqual(columnsFor('Req', false).map((c) => c.id), ['todo', 'doing'])
  assert.deepEqual(columnsFor('Req', true).map((c) => c.id), ['todo', 'doing', 'closed'])
  assert.deepEqual(columnsFor('Bug', false).map((c) => c.stages), [['1'], ['2'], ['3']])
})

test('search body filters by stage and subject', () => {
  const body = searchBody({ spaceId: 's', category: 'Req', stages: ['1'], q: '凭证', page: 1 })
  assert.equal(body.category, 'Req')
  assert.equal(body.spaceId, 's')
  assert.equal(body.orderBy, 'gmtModified')
  const groups = JSON.parse(body.conditions).conditionGroups
  assert.equal(groups.length, 2)
  assert.equal(groups[0][0].fieldIdentifier, 'statusStage')
  assert.deepEqual(groups[0][0].value, ['1'])
  assert.equal(groups[1][0].fieldIdentifier, 'subject')
})

test('status name match refuses zero or many', () => {
  const statuses = [{ id: '1', name: '待处理' }, { id: '2', name: '开发中' }]
  assert.equal(matchStatus(statuses, '1').id, '1')
  assert.equal(matchStatus(statuses, '开发中').id, '2')
  assert.throws(() => matchStatus(statuses, '不存在'), /候选/)
  assert.throws(() => matchStatus([...statuses, { id: '3', name: '开发中' }], '开发中'), /候选/)
})
```

- [ ] **Step 2: 跑测试，确认新用例失败**

Run: `node --test test/yunxiao.test.js`
Expected: 新用例 FAIL，Task 1 的用例仍 PASS。

- [ ] **Step 3: 实现 `server/board.js`**

```js
const REQ = [
  { id: 'todo', label: '待处理', stages: ['1'] },
  { id: 'doing', label: '进行中', stages: ['2', '3'] },
  { id: 'closed', label: '已结束', stages: ['4', '5'], closed: true },
]
const BUG = [
  { id: 'todo', label: '待确认', stages: ['1'] },
  { id: 'doing', label: '处理中', stages: ['2'] },
  { id: 'fixed', label: '已修复', stages: ['3'] },
  { id: 'closed', label: '已结束', stages: ['4', '5'], closed: true },
]

export function columnsFor(category, includeClosed) {
  const all = category === 'Bug' ? BUG : REQ
  return includeClosed ? all : all.filter((c) => !c.closed)
}

function condition(fieldIdentifier, value, className, format) {
  return { fieldIdentifier, operator: 'CONTAINS', value, toValue: null, className, format }
}

export function searchBody({ spaceId, category, stages, q, page = 1, perPage = 50 }) {
  const groups = [[condition('statusStage', stages, 'statusStage', 'list')]]
  const text = typeof q === 'string' ? q.trim() : ''
  if (text) groups.push([condition('subject', text, 'string', 'input')])
  return {
    spaceId,
    category,
    page,
    perPage,
    orderBy: 'gmtModified',
    sort: 'desc',
    conditions: JSON.stringify({ conditionGroups: groups }),
  }
}

export function matchStatus(statuses, wanted) {
  const text = String(wanted ?? '').trim()
  const hits = statuses.filter((s) => s.id === text || s.name === text)
  if (hits.length !== 1) {
    const names = statuses.map((s) => `${s.name}(${s.id})`).join('、')
    throw new Error(`状态不唯一或不存在，候选：${names}`)
  }
  return hits[0]
}

export function cardOf(item) {
  return {
    id: item.id,
    serialNumber: item.serialNumber,
    subject: item.subject,
    status: item.status?.name ?? '',
    statusId: item.status?.id ?? '',
    stage: String(item.statusStageId ?? ''),
    assignee: item.assignedTo?.name ?? '',
    type: item.workitemType?.name ?? '',
    category: item.categoryId,
    updatedAt: item.gmtModified ?? null,
  }
}
```

- [ ] **Step 4: 跑测试，确认通过**

Run: `node --test test/yunxiao.test.js`
Expected: PASS。

## Task 3: 云效客户端

**Files:**
- Create: `server/yunxiao.js`
- Modify: `test/yunxiao.test.js`

- [ ] **Step 1: 追加失败测试**

用假 `fetch`。断言：请求头是 `x-yunxiao-token`；`board` 在 `includeClosed` 为假时不为阶段 4/5 发请求；`transition` 的 PUT body 只有 `status`；状态名先 GET workflow 再 PUT。

```js
import { createClient } from '../server/yunxiao.js'

function fakeFetch(routes) {
  const calls = []
  const fetch = async (url, init = {}) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : undefined })
    const hit = routes.find((r) => url.includes(r.match))
    if (!hit) throw new Error(`unmocked ${url}`)
    return new Response(JSON.stringify(hit.json ?? {}), {
      status: hit.status ?? 200,
      headers: hit.headers ?? { 'x-total': '1' },
    })
  }
  return { fetch, calls }
}

test('board does not request closed stages by default', async () => {
  const { fetch, calls } = fakeFetch([
    { match: 'workitems:search', json: [{ id: 'a', serialNumber: 'EVXU-1', subject: 't', status: { name: '待处理', id: '100005' }, statusStageId: '1', categoryId: 'Req' }] },
  ])
  const client = createClient({ token: 't', organizationId: 'o' }, { fetch, env: {} })
  const board = await client.board({ spaceId: 's', category: 'Req' })
  assert.equal(calls.length, 2)
  assert.equal(board.columns.map((c) => c.id).join(), 'todo,doing')
  assert.equal(board.columns[0].cards[0].serialNumber, 'EVXU-1')
})

test('transition resolves a status name then puts only status', async () => {
  const { fetch, calls } = fakeFetch([
    { match: '/workflow', json: { statuses: [{ id: '142838', name: '开发中' }, { id: '100005', name: '待处理' }] } },
    { match: '/workitems/', json: {} },
  ])
  const client = createClient({ token: 't', organizationId: 'o' }, { fetch, env: {} })
  await client.transition({ id: 'wid', status: '开发中' })
  const put = calls.find((c) => c.init.method === 'PUT')
  assert.deepEqual(put.body, { status: '142838' })
  assert.equal(put.init.headers['x-yunxiao-token'], 't')
})
```

- [ ] **Step 2: 跑测试，确认新用例失败**

Run: `node --test test/yunxiao.test.js`
Expected: 新用例 FAIL。

- [ ] **Step 3: 实现 `server/yunxiao.js`**

```js
import { resolveConnection } from './config.js'
import { cardOf, columnsFor, matchStatus, searchBody } from './board.js'

export function createClient(config, { fetch, env } = {}) {
  const connection = resolveConnection(config, env)
  async function request(url, { method = 'GET', body } = {}) {
    const response = await fetch(url, {
      method,
      headers: { 'x-yunxiao-token': connection.token, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await response.text()
    const json = text ? JSON.parse(text) : {}
    if (!response.ok) throw new Error(json.errorMessage || `云效请求失败 ${response.status}`)
    return { json, total: Number(response.headers.get('x-total') || 0) }
  }
  async function search(body) {
    return request(connection.workitemsSearch, { method: 'POST', body })
  }
  async function resolveId(id) {
    if (!String(id).includes('-')) return id
    const { json: projects } = await request(connection.projectsSearch, { method: 'POST', body: { page: 1, perPage: 50 } })
    for (const project of projects) {
      const { json } = await search({ spaceId: project.id, page: 1, perPage: 20, conditions: JSON.stringify({ conditionGroups: [[{ fieldIdentifier: 'subject', operator: 'CONTAINS', value: id, className: 'string', format: 'input' }]] }) })
      const hit = json.find((item) => item.serialNumber === id)
      if (hit) return hit.id
    }
    throw new Error(`找不到工作项 ${id}`)
  }
  async function loadColumn(query, column, page) {
    const { json, total } = await search(searchBody({ ...query, stages: column.stages, page }))
    return { id: column.id, label: column.label, category: query.category, total, cards: json.map(cardOf) }
  }
  return {
    projects: async () => {
      const { json } = await request(connection.projectsSearch, { method: 'POST', body: { page: 1, perPage: 50 } })
      return json.map((p) => ({ id: p.id, name: p.name, code: p.customCode }))
    },
    board: async ({ spaceId, category = 'Req', q, includeClosed = false }) => {
      const categories = category === 'All' ? ['Req', 'Bug'] : [category]
      const columns = []
      for (const cat of categories) {
        for (const column of columnsFor(cat, includeClosed)) columns.push(await loadColumn({ spaceId, category: cat, q }, column, 1))
      }
      return { columns }
    },
    column: ({ spaceId, category, stage, page = 1, q }) => {
      const column = columnsFor(category, true).find((c) => c.id === stage)
      if (!column) throw new Error(`未知栏 ${stage}`)
      return loadColumn({ spaceId, category, q }, column, page)
    },
    transitions: async (id) => {
      const wid = await resolveId(id)
      const { json } = await request(connection.workflow(wid))
      return json.statuses.map((s) => ({ id: s.id, name: s.name }))
    },
    transition: async ({ id, status }) => {
      const wid = await resolveId(id)
      const { json } = await request(connection.workflow(wid))
      const hit = matchStatus(json.statuses, status)
      await request(connection.workitem(wid), { method: 'PUT', body: { status: hit.id } })
      const after = await request(connection.workitem(wid))
      return cardOf(after.json)
    },
  }
}
```

- [ ] **Step 4: 跑测试，确认通过**

Run: `node --test test/yunxiao.test.js`
Expected: PASS。补一条编号解析测试：两个项目，只有一个返回精确 `serialNumber`。

## Task 4: Host 插件、Service、AI 工具

**Files:**
- Create: `package.json` `cordis.patch.yml` `locale/zh.json` `locale/en.json` `icon.svg` `index.js`

- [ ] **Step 1: 包清单**

`package.json`：

```json
{
  "name": "@local/yunxiao-taskboard",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./index.js",
    "./client": "./client.js",
    "./locale/*.json": "./locale/*.json",
    "./icon": "./icon.svg"
  },
  "files": ["index.js", "client.js", "server", "cordis.patch.yml", "locale", "icon.svg"],
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "platform": "web", "immediately": true, "inject": [] }
  }
}
```

`cordis.patch.yml`：

```yaml
- insert:
    - id: yunxiao-taskboard
      name: '@local/yunxiao-taskboard'
```

`locale/zh.json`：`meta.title` = `云效进度`，`meta.description` = `查看和流转云效需求与缺陷`。
`locale/en.json`：`Yunxiao board` / `View and transition Yunxiao requirements and bugs`。
`icon.svg`：一块看板，三列竖条，自绘，不拷贝第三方图标。

- [ ] **Step 2: Host**

`index.js` 依赖 `@deepseek-ai/cordis` 的 `Service`、`Remote`，以及 `@deepseek-ai/dsh-tools` 的 `defineTool`。这两个包由 Harness 安装提供，插件 `package.json` 不声明 dependency。

```js
import { Service } from '@deepseek-ai/cordis'
import { Remote } from '@deepseek-ai/dsh-typert-protocol'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { z } from '@deepseek-ai/schemastery'
import { createClient } from './server/yunxiao.js'

export const inject = ['tools']
export const Config = z.object({
  token: z.string().role('secret').default(''),
  organizationId: z.string().default(''),
  baseUrl: z.string().default(''),
  edition: z.union([z.const('center'), z.const('region'), z.const('')]).default(''),
})

class Yunxiao extends Service {
  static inject = ['tools']
  constructor(ctx, config) {
    super(ctx, 'yunxiao')
    this.config = config
  }
  client() { return createClient(this.config, { fetch: globalThis.fetch }) }
  @Remote() projects() { return this.client().projects() }
  @Remote() board(query) { return this.client().board(query) }
  @Remote() column(query) { return this.client().column(query) }
  @Remote() transitions(id) { return this.client().transitions(id) }
  @Remote() transition(input) { return this.client().transition(input) }
}

export function apply(ctx, config) {
  ctx.plugin(Yunxiao, config)
  const api = () => ctx.yunxiao
  ctx.tools.register(defineTool({
    name: 'yunxiao_workitems',
    description: 'Read Yunxiao projects, work items, or legal statuses. action=projects|search|transitions. Call transitions before changing a status. Do not guess status names.',
    parameters: {
      action: { type: 'string', required: true, enum: ['projects', 'search', 'transitions'] },
      spaceId: { type: 'string' },
      category: { type: 'string', enum: ['Req', 'Bug', 'All'] },
      q: { type: 'string' },
      id: { type: 'string', description: 'Work item id or serial number such as EVXU-1095' },
    },
    output: { schema: { type: 'object' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] },
    async execute(args) {
      if (args.action === 'projects') return { projects: await api().projects() }
      if (args.action === 'transitions') return { statuses: await api().transitions(args.id) }
      return api().board({ spaceId: args.spaceId, category: args.category ?? 'Req', q: args.q, includeClosed: false })
    },
  }))
  ctx.tools.register(defineTool({
    name: 'yunxiao_transition',
    description: 'Move a Yunxiao work item to a status from its workflow. status is a status id or an exact unique status name. 403 means the token has no write permission.',
    parameters: {
      id: { type: 'string', required: true },
      status: { type: 'string', required: true },
    },
    output: { schema: { type: 'object' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] },
    execute: (args) => api().transition(args),
  }))
}
```

`@Remote()` 装饰器若在当前 Node 下不能直接放在类字段方法上，改成文档化的 `Remote(Yunxiao.prototype, 'projects')` 调用形式，以 `dsh-typert-protocol` 的导出为准。安装后用 `cordis_inspect_query` 的 Client Service 目录确认 `yunxiao` 的五个方法出现。

token 字段用 `role('secret')`。若安装后的 Config schema 没有把该字段标成不回显，改成与 `@deepseek-ai/dsh-llm-deepseek-api-key` 相同的 credential-ref 不可行（那是环境变量名，不是令牌值）。此时保留 secret role，并在交付说明里写明设置页是否回显，不把令牌打进日志。

- [ ] **Step 3: 语法检查**

Run: `node --check index.js && node --check server/yunxiao.js && node --test`
Expected: 语法通过，测试 PASS。

## Task 5: 看板

**Files:**
- Create: `client.js`

- [ ] **Step 1: 注册侧边栏和主面板**

`client.js` 用 `window.__ModuleLoader__.load`。`inject: ['slots']`。

- `sidebar.panellist`：`id: 'yunxiao'`，`label: '云效'`，图标组件。
- `main`：`key: 'yunxiao'`，看板组件。

看板组件从 `ctx.remote.yunxiao` 取数。若 Client 的 remote 命名空间要等 typert 扫描后才出现，安装后用 Client `listService` 确认名字，再改调用点。不要猜第二套 RPC。

- [ ] **Step 2: 界面**

顶栏：项目下拉、类型（需求/缺陷/全部）、搜索框、刷新。项目 id 记在 `localStorage` 键 `yunxiao.spaceId`。

主区：横向栏。栏头是栏名和 `total`。卡片是编号、标题、负责人、更新时间。更新时间用本地时区的 `MM-DD HH:mm`。

流转：卡片按钮先 `transitions(id)`，列出返回的状态。选中后 `transition({ id, status: statusId })`。失败把 `error.message` 显示在该卡片下，不改栏。

空态文案：

- 未配置云效令牌
- 未配置组织 ID
- 没有工作项
- 没有匹配

样式用内联 style。浅底、细边框、编号等宽。栏头色：待处理 `#8a6a2f`，进行中 `#2f5f8a`，已修复 `#2f6b4f`，已结束 `#6b6b6b`。不引入 CSS 框架。

「含已结束」是一个开关，默认关。打开后 `includeClosed: true`。

- [ ] **Step 3: 不在这一步声称视觉通过**

安装前只做语法检查：`node --check client.js`。

## Task 6: 安装与只读核对

- [ ] **Step 1: 安装插件**

用 `plugin_manager` `install_bundle`，`target` 为这个仓库的绝对路径。不手改 profile 的 `package.json` 或 `cordis.patch.yml`。

- [ ] **Step 2: 确认注册**

`cordis_inspect_query`：Host Config 能看到这行的 schema；Client Service 能看到 `yunxiao` 的 Remote 方法；Client Slots 的 `sidebar.panellist` 和 `main` 有 `yunxiao`。

- [ ] **Step 3: 只读核对**

插件 Config 先留空，依赖环境变量 `YUNXIAO_API_KEY` 和 `YUNXIAO_ORG_ID`。`YUNXIAO_ORG_ID` 若未设置，在插件配置里填 `6195b7c32873bc436ca4df89`。

用 Host 方法或工具 `yunxiao_workitems` 查 EVXU（`167a4a9022031fec9a3da7044f`）需求。待处理栏 `total` 应接近 184。不要求精确等于，云效数据会变。

不要调用 `yunxiao_transition` 打真实工作项。当前令牌没有写权限。

- [ ] **Step 4: 页面**

刷新 `http://127.0.0.1:3080`。侧边栏应有「云效」。打开后能看到项目和栏。若浏览器自动化不可用，报告槽位已注册、页面视觉未验证。

## 不做

- 不移植 dashi-taskboard。
- 不建 SQLite，不做 30 秒缓存，除非真请求慢到不可用。
- 不把已结束工作项默认拉进看板。
- 不在插件里写死状态机。
- 不验证真实 PUT，直到令牌有项目协作读写权限。

## 开发阶段与状态约定

| 阶段 | 需求 | 缺陷 |
| --- | --- | --- |
| 开始开发 | 开发中 | 处理中 |
| 提交推送后 | 测试中 | 已修复 |

- `yunxiao_transition` 支持 `phase: start | pushed`，由 Host 读取工作项 `categoryId` 后映射成上表的状态名，调用方不用记状态名。
- 看板卡片点「处理」时自动按 `phase: start` 流转；失败（如 token 无写权限）会在卡片上提示，但仍会打开工作区会话。
- 「提交推送后」的流转由执行开发的 agent 在 push 之后调用 `yunxiao_transition({ id, phase: "pushed" })`；插件没有接管 git hook，提示词里已写明这一步。
