// 优先级是云效标准字段，identifier 各项目一致
export const PRIORITIES = [
  { id: 'urgent', label: '紧急', identifier: '96ae7172b94949c7a43da0e94b' },
  { id: 'high', label: '高', identifier: '498c2c7c68879672ca3508be5e' },
  { id: 'medium', label: '中', identifier: '0bd46b8d70262ac77aeedd4c00' },
  { id: 'low', label: '低', identifier: '1aa226b1b1b57ddf7a67897d35' },
]

function condition(fieldIdentifier, value, className, format) {
  return { fieldIdentifier, operator: 'CONTAINS', value, toValue: null, className, format }
}

export function searchBody({ spaceId, category, status, q, priority, page = 1, perPage = 50 }) {
  // yunxiao ANDs conditions inside one group and ORs across groups, so every filter shares one group
  const group = []
  if (status) group.push(condition('status', [status], 'status', 'list'))
  const text = typeof q === 'string' ? q.trim() : ''
  if (text) group.push(condition('subject', text, 'string', 'input'))
  const level = PRIORITIES.find((candidate) => candidate.id === priority || candidate.label === priority)
  if (level) group.push(condition('priority', [level.identifier], 'list', 'list'))
  return {
    spaceId,
    category,
    page,
    perPage,
    orderBy: 'serialNumber',
    sort: 'desc',
    conditions: JSON.stringify({ conditionGroups: group.length ? [group] : [] }),
  }
}

// 开发阶段到云效状态的约定映射
export const PHASE_STATUS = {
  Req: { start: '开发中', pushed: '测试中' },
  Bug: { start: '处理中', pushed: '已修复' },
}

export function statusForPhase(category, phase) {
  const map = PHASE_STATUS[category]
  if (!map || !map[phase]) throw new Error(`未知阶段 ${category}/${phase}`)
  return map[phase]
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

function priorityOf(item) {
  const field = (item.customFieldValues ?? []).find((candidate) => candidate.fieldId === 'priority' || candidate.fieldName === '优先级')
  return field?.values?.[0]?.displayValue ?? ''
}

// 关联提交接口要的是 codeup 代码库 id，调用方通常只有提交页 URL，这里从 URL 反查
export function repoPathOf(url) {
  const text = String(url ?? '').trim().replace(/^git@([^:]+):/, 'https://$1/')
  if (!text) return ''
  let path
  try {
    path = new URL(text).pathname
  } catch {
    return ''
  }
  path = path.replace(/^\/+|\/+$/g, '').replace(/\.git$/, '')
  const cut = path.search(/\/(commit|commits|tree|blob|merge_request|merge_requests)(\/|$)/)
  return cut >= 0 ? path.slice(0, cut) : path
}

export function repoIdOf(repositories, url) {
  const target = repoPathOf(url)
  if (!target) return ''
  for (const repo of Array.isArray(repositories) ? repositories : []) {
    const path = repo?.pathWithNamespace || repoPathOf(repo?.httpUrlToRepo ?? repo?.sshUrlToRepo)
    if (!path) continue
    if (target === path || target.startsWith(`${path}/`)) return String(repo.id)
  }
  return ''
}

export function cardOf(item) {
  return {
    id: item.id,
    serialNumber: item.serialNumber,
    subject: item.subject,
    status: item.status?.name ?? '',
    statusId: item.status?.id ?? '',
    assignee: item.assignedTo?.name ?? '',
    priority: priorityOf(item),
    type: item.workitemType?.name ?? '',
    category: item.categoryId,
    spaceId: item.space?.id ?? '',
    updatedAt: item.gmtModified ?? null,
  }
}

export function plainText(html) {
  return String(html ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function unwrapDescription(value) {
  // yunxiao returns the rich-text envelope as a JSON string for some workitem types
  if (typeof value !== 'string') return value ?? {}
  try {
    return JSON.parse(value)
  } catch {
    return { htmlValue: value }
  }
}

export function descriptionText(value) {
  return plainText(unwrapDescription(value).htmlValue ?? '')
}

export function descriptionHtml(value) {
  return String(unwrapDescription(value).htmlValue ?? '')
}

export function detailOf(item) {
  return {
    ...cardOf(item),
    description: descriptionText(item.description),
    creator: item.creator?.name ?? '',
    space: item.space?.name ?? '',
    createdAt: item.gmtCreate ?? null,
  }
}
