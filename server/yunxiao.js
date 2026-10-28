import { resolveConnection } from './config.js'
import { cardOf, descriptionHtml, detailOf, matchStatus, repoIdOf, searchBody, statusForPhase } from './board.js'

// 组织列表挂在 platform 根下，不在某个组织的 projex 路径里；借用 region 连接只为拿令牌和域名，无需组织 ID
export async function listOrganizations(config = {}, { fetch, env } = {}) {
  const connection = resolveConnection({ ...config, edition: 'region' }, env)
  const response = await fetch(`${connection.baseUrl}/oapi/v1/platform/organizations`, {
    headers: { 'x-yunxiao-token': connection.token },
  })
  const text = await response.text()
  const json = text ? JSON.parse(text) : {}
  if (!response.ok) throw new Error(json.errorMessage || `云效请求失败 ${response.status}`)
  const list = Array.isArray(json) ? json : (json.organizations ?? [])
  const seen = new Set()
  const result = []
  for (const item of list) {
    if (!item?.id || seen.has(item.id)) continue
    seen.add(item.id)
    result.push({ id: item.id, name: item.name || item.id })
  }
  return result
}

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
  // 代码库列表只用于把提交 URL 反查成关联接口要的代码库 id
  async function codeupRepositories() {
    const { json } = await request(connection.codeupRepositories)
    return Array.isArray(json) ? json : []
  }
  async function resolveId(id) {
    if (!String(id).includes('-')) return id
    const { json: projects } = await request(connection.projectsSearch, { method: 'POST', body: { page: 1, perPage: 50 } })
    const conditions = JSON.stringify({ conditionGroups: [[{ fieldIdentifier: 'serialNumber', operator: 'CONTAINS', value: id, className: 'string', format: 'input' }]] })
    for (const project of projects) {
      for (const category of ['Req', 'Bug']) {
        const { json } = await search({ spaceId: project.id, category, page: 1, perPage: 10, conditions })
        const hit = json.find((item) => item.serialNumber === id)
        if (hit) return hit.id
      }
    }
    throw new Error(`找不到工作项 ${id}`)
  }
  // 每类工作项的状态列取自它自己的 workflow，顺序即云效看板顺序
  const statusCache = new Map()
  async function statusesFor(spaceId, category) {
    const key = `${spaceId}:${category}`
    const cached = statusCache.get(key)
    if (cached && Date.now() - cached.at < 60000) return cached.value
    const { json } = await search({ spaceId, category, page: 1, perPage: 1, orderBy: 'serialNumber', sort: 'desc' })
    if (!json.length) return []
    const { json: flow } = await request(connection.workflow(json[0].id))
    const value = (flow.statuses ?? []).map((status) => ({ id: status.id, name: status.name }))
    statusCache.set(key, { at: Date.now(), value })
    return value
  }
  async function loadColumn(query, status, page = 1) {
    const { json, total } = await search(searchBody({ ...query, status: status.id, page }))
    return { id: status.id, label: status.name, category: query.category, total, cards: json.map(cardOf) }
  }
  return {
    projects: async () => {
      const { json } = await request(connection.projectsSearch, { method: 'POST', body: { page: 1, perPage: 50 } })
      return json.map((p) => ({ id: p.id, name: p.name, code: p.customCode }))
    },
    board: async ({ spaceId, category = 'Req', q, priority }) => {
      const categories = category === 'All' ? ['Req', 'Bug'] : [category]
      const text = typeof q === 'string' ? q.trim() : ''
      if (/^[A-Za-z]+-\d+$/.test(text)) {
        let item = null
        try {
          item = (await request(connection.workitem(await resolveId(text)))).json
        } catch {}
        const columns = []
        for (const cat of categories) {
          for (const status of await statusesFor(spaceId, cat)) {
            const hit = item && item.categoryId === cat && item.status?.id === status.id
            columns.push({ id: status.id, label: status.name, category: cat, total: hit ? 1 : 0, cards: hit ? [cardOf(item)] : [] })
          }
        }
        return { columns }
      }
      const columns = []
      for (const cat of categories) {
        const statuses = await statusesFor(spaceId, cat)
        const loaded = await Promise.all(statuses.map((status) => loadColumn({ spaceId, category: cat, q, priority }, status)))
        columns.push(...loaded)
      }
      return { columns }
    },
    column: async ({ spaceId, category, status, page = 1, q, priority }) => {
      const hit = (await statusesFor(spaceId, category)).find((candidate) => candidate.id === status || candidate.name === status)
      if (!hit) throw new Error(`未知状态 ${status}`)
      return loadColumn({ spaceId, category, q, priority }, hit, page)
    },
    detail: async (id) => {
      const wid = await resolveId(id)
      const item = (await request(connection.workitem(wid))).json
      const detail = detailOf(item)
      detail.descriptionHtml = descriptionHtml(item.description)

      // 描述里的图默认是网页登录态地址；OpenAPI 能换出可匿名访问的 OSS 直链
      const fileUrls = new Map()
      const fileUrl = async (fileId) => {
        if (fileUrls.has(fileId)) return fileUrls.get(fileId)
        let url = null
        try {
          url = (await request(`${connection.workitem(wid)}/files/${encodeURIComponent(fileId)}`)).json.url ?? null
        } catch {}
        fileUrls.set(fileId, url)
        return url
      }

      const embedded = [...new Set([...detail.descriptionHtml.matchAll(/fileIdentifier=([\w-]+)/g)].map((match) => match[1]))]
      await Promise.all(embedded.map(fileUrl))
      detail.descriptionHtml = detail.descriptionHtml.replace(
        /https:\/\/devops\.aliyun\.com\/[^"'\s]*?fileIdentifier=([\w-]+)/g,
        (raw, fileId) => fileUrls.get(fileId) ?? raw,
      )

      detail.attachments = []
      try {
        const { json } = await request(`${connection.workitem(wid)}/attachments`)
        for (const file of Array.isArray(json) ? json : []) {
          const fileId = file.fileIdentifier ?? file.id
          if (!fileId) continue
          detail.attachments.push({
            id: fileId,
            name: file.name ?? file.fileName ?? fileId,
            size: file.size ?? file.fileSize ?? null,
            creator: file.creator?.name ?? '',
            createdAt: file.gmtCreate ?? null,
            url: await fileUrl(fileId),
          })
        }
      } catch {}
      return detail
    },
    // 改动留档：评论正文是主体，推送的提交补在正文并关联到需求的代码提交记录
    comment: async ({ id, content, commits, projectId }) => {
      const text = String(content ?? '').trim()
      if (!text) throw new Error('评论内容不能为空')
      const wid = await resolveId(id)
      const pushed = (Array.isArray(commits) ? commits : []).filter((commit) => commit && String(commit.sha ?? '').trim())
      // 正文里已经点到的提交不再重复追加，避免同一提交出现两次
      const extra = pushed.filter((commit) => !text.includes(String(commit.sha).trim()))
      const body = extra.length
        ? `${text}\n\n**关联提交**\n${extra.map((commit) => {
          const sha = String(commit.sha).trim()
          return `- ${commit.url ? `[${sha}](${commit.url})` : `\`${sha}\``}${commit.title ? ` ${commit.title}` : ''}`
        }).join('\n')}`
        : text
      const { json } = await request(connection.comments(wid), { method: 'POST', body: { content: body, formatType: 'MARKDOWN' } })
      const linked = []
      if (pushed.length) {
        let repositories = []
        const needsRepository = pushed.some((commit) => !commit.projectId && !projectId)
        if (needsRepository) {
          try {
            repositories = await codeupRepositories()
          } catch {}
        }
        for (const commit of pushed) {
          const sha = String(commit.sha).trim()
          const repoId = String(commit.projectId || projectId || repoIdOf(repositories, commit.url) || '').trim()
          if (!repoId) {
            linked.push({ sha, linked: false, error: '缺少代码库 id，无法关联到需求；请在 commits 里补 projectId 或 Codeup 提交页 url' })
            continue
          }
          try {
            await request(connection.extRelations(wid), { method: 'POST', body: {
              category: 'codeupCommit',
              projectId: repoId,
              commitSha: sha,
              title: commit.title ?? '',
              url: commit.url ?? '',
            } })
            linked.push({ sha, linked: true })
          } catch (error) {
            linked.push({ sha, linked: false, error: error?.message || '关联提交失败' })
          }
        }
      }
      return { workitemId: wid, commentId: json.id ?? null, commits: linked }
    },
    transitions: async (id) => {
      const wid = await resolveId(id)
      const { json } = await request(connection.workflow(wid))
      return json.statuses.map((s) => ({ id: s.id, name: s.name }))
    },
    transition: async ({ id, status, phase }) => {
      const wid = await resolveId(id)
      const current = (await request(connection.workitem(wid))).json
      const wanted = phase ? statusForPhase(current.categoryId, phase) : status
      if (!wanted) throw new Error('需要 status 或 phase')
      const { json } = await request(connection.workflow(wid))
      const hit = matchStatus(json.statuses, wanted)
      await request(connection.workitem(wid), { method: 'PUT', body: { status: hit.id } })
      const after = await request(connection.workitem(wid))
      return cardOf(after.json)
    },
  }
}
