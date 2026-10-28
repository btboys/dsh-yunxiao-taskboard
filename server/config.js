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
    comments: (id) => `${root}/workitems/${encodeURIComponent(id)}/comments`,
    extRelations: (id) => `${root}/workitems/${encodeURIComponent(id)}/extRelationRecords`,
    // 代码管理是独立产品路径，中心版带组织段，Region 版不带
    codeupRepositories: edition === 'center'
      ? `${baseUrl}/oapi/v1/codeup/organizations/${encodeURIComponent(organizationId)}/repositories`
      : `${baseUrl}/oapi/v1/codeup/repositories`,
  }
}
