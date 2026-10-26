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
  assert.equal(c.workitemsSearch, 'https://env.example/oapi/v1/projex/organizations/org/workitems:search')
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

import { cardOf, searchBody, matchStatus, detailOf, statusForPhase } from '../server/board.js'

test('search body filters by status and subject', () => {
  const body = searchBody({ spaceId: 's', category: 'Req', status: '100005', q: '凭证', page: 1 })
  assert.equal(body.category, 'Req')
  assert.equal(body.spaceId, 's')
  assert.equal(body.orderBy, 'serialNumber')
  const groups = JSON.parse(body.conditions).conditionGroups
  assert.equal(groups.length, 1)
  assert.equal(groups[0].length, 2)
  assert.equal(groups[0][0].fieldIdentifier, 'status')
  assert.deepEqual(groups[0][0].value, ['100005'])
  assert.equal(groups[0][1].fieldIdentifier, 'subject')
})

test('search body omits the condition groups when nothing filters', () => {
  const body = searchBody({ spaceId: 's', category: 'Bug' })
  assert.deepEqual(JSON.parse(body.conditions).conditionGroups, [])
})

test('status name match refuses zero or many', () => {
  const statuses = [{ id: '1', name: '待处理' }, { id: '2', name: '开发中' }]
  assert.equal(matchStatus(statuses, '1').id, '1')
  assert.equal(matchStatus(statuses, '开发中').id, '2')
  assert.throws(() => matchStatus(statuses, '不存在'), /候选/)
  assert.throws(() => matchStatus([...statuses, { id: '3', name: '开发中' }], '开发中'), /候选/)
})

import { createClient, listOrganizations } from '../server/yunxiao.js'

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

test('board builds one column per workflow status', async () => {
  const { fetch, calls } = fakeFetch([
    { match: '/workflow', json: { statuses: [{ id: '100005', name: '待处理' }, { id: '142838', name: '开发中' }, { id: '100014', name: '已完成' }] } },
    { match: 'workitems:search', json: [{ id: 'a', serialNumber: 'EVXU-1', subject: 't', status: { name: '待处理', id: '100005' }, categoryId: 'Req' }] },
  ])
  const client = createClient({ token: 't', organizationId: 'o' }, { fetch, env: {} })
  const board = await client.board({ spaceId: 's', category: 'Req' })
  assert.deepEqual(board.columns.map((c) => c.label), ['待处理', '开发中', '已完成'])
  const statuses = calls
    .filter((call) => call.body?.conditions)
    .map((call) => JSON.parse(call.body.conditions).conditionGroups[0][0].value[0])
  assert.deepEqual(statuses, ['100005', '142838', '100014'])
  assert.equal(board.columns[0].cards[0].serialNumber, 'EVXU-1')
})

test('serial lookup returns the project whose serialNumber matches exactly', async () => {
  const { fetch, calls } = fakeFetch([
    { match: 'projects:search', json: [{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }] },
    { match: 'workitems:search', json: [{ id: 'wrong', serialNumber: 'EVXU-10950', subject: 'EVXU-1095 noise' }] },
    { match: '/workflow', json: { statuses: [{ id: '100005', name: '待处理' }] } },
  ])
  const realFetch = fetch
  const client = createClient({ token: 't', organizationId: 'o' }, {
    env: {},
    fetch: async (url, init = {}) => {
      const body = init.body ? JSON.parse(init.body) : undefined
      if (String(url).includes('workitems:search') && body?.spaceId === 'p2') {
        calls.push({ url, init, body })
        return new Response(JSON.stringify([{ id: 'hit', serialNumber: 'EVXU-1095', subject: 'exact' }]), {
          status: 200,
          headers: { 'x-total': '1' },
        })
      }
      return realFetch(url, init)
    },
  })
  await client.transitions('EVXU-1095')
  const searches = calls.filter((c) => String(c.url).includes('workitems:search'))
  assert.deepEqual(searches.map((c) => [c.body.spaceId, c.body.category]), [
    ['p1', 'Req'], ['p1', 'Bug'], ['p2', 'Req'],
  ])
  const conditions = JSON.parse(searches[0].body.conditions).conditionGroups[0][0]
  assert.equal(conditions.fieldIdentifier, 'serialNumber')
  const workflow = calls.find((c) => String(c.url).includes('/workflow'))
  assert.match(workflow.url, /\/workitems\/hit\/workflow$/)
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

test('serial search fetches the item and places it in its column', async () => {
  const { fetch, calls } = fakeFetch([
    { match: 'projects:search', json: [{ id: 'p1', name: 'A' }] },
    { match: '/workflow', json: { statuses: [{ id: '100005', name: '待处理' }, { id: '142838', name: '开发中' }] } },
    { match: 'workitems:search', json: [{ id: 'wid', serialNumber: 'EVXU-1095', categoryId: 'Req' }] },
    { match: '/workitems/wid', json: { id: 'wid', serialNumber: 'EVXU-1095', subject: '凭证', categoryId: 'Req', status: { name: '待处理', id: '100005' } } },
  ])
  const client = createClient({ token: 't', organizationId: 'o' }, { fetch, env: {} })
  const board = await client.board({ spaceId: 'p1', category: 'Req', q: 'EVXU-1095' })
  assert.deepEqual(board.columns.map((c) => [c.label, c.total]), [['待处理', 1], ['开发中', 0]])
  assert.equal(board.columns[0].cards[0].subject, '凭证')
  assert.ok(calls.every((c) => !String(c.url).includes('subject')))
})

test('detail strips rich text and keeps the readable fields', async () => {
  const { fetch } = fakeFetch([
    { match: '/workitems/wid', json: {
      id: 'wid',
      serialNumber: 'EVXU-1095',
      subject: '凭证录入偏好',
      description: { htmlValue: '<article><p>第一段&nbsp;文本</p><p>第二段</p></article>' },
      status: { name: '待处理', id: '100005' },
      statusStageId: '1',
      categoryId: 'Req',
      workitemType: { name: '产品类需求' },
      assignedTo: { name: '夏悸' },
      creator: { name: '沈晓晶' },
      space: { name: '纷析云财务' },
      gmtCreate: 1792738861000,
      gmtModified: 1792738861000,
    } },
  ])
  const client = createClient({ token: 't', organizationId: 'o' }, { fetch, env: {} })
  const detail = await client.detail('wid')
  assert.equal(detail.serialNumber, 'EVXU-1095')
  assert.equal(detail.creator, '沈晓晶')
  assert.equal(detail.description, '第一段 文本\n第二段')
  assert.equal(detail.type, '产品类需求')
})

test('detail unwraps a rich-text envelope delivered as a JSON string', () => {
  const detail = detailOf({
    id: 'wid',
    serialNumber: 'EVXU-1',
    description: JSON.stringify({ htmlValue: '<p>甲&nbsp;乙</p><p>丙</p>' }),
  })
  assert.equal(detail.description, '甲 乙\n丙')
})

test('detail carries the rich html and maps attachments to oss urls', async () => {
  const { fetch } = fakeFetch([
    { match: '/files/abc123', json: { url: 'https://oss.example/shot.png' } },
    { match: '/attachments', json: [{ fileIdentifier: 'abc123', name: '截图.png', size: 2048, creator: { name: '沈晓晶' } }] },
    { match: '/workitems/wid', json: {
      id: 'wid',
      serialNumber: 'EVXU-1',
      description: JSON.stringify({ htmlValue: '<p>甲<img src="https://devops.aliyun.com/x?fileIdentifier=abc123"></p>' }),
    } },
  ])
  const client = createClient({ token: 't', organizationId: 'o' }, { fetch, env: {} })
  const detail = await client.detail('wid')
  assert.match(detail.descriptionHtml, /<img src="https:\/\/oss\.example\/shot\.png">/)
  assert.equal(detail.description, '甲')
  assert.deepEqual(detail.attachments.map((f) => [f.id, f.name, f.size, f.url]), [['abc123', '截图.png', 2048, 'https://oss.example/shot.png']])
})

test('detail swaps embedded images for anonymous oss urls', async () => {
  const { fetch, calls } = fakeFetch([
    { match: '/files/f1', json: { url: 'https://oss.example/img.png' } },
    { match: '/workitems/wid', json: {
      id: 'wid',
      serialNumber: 'EVXU-1',
      description: JSON.stringify({ htmlValue: '<p><img src="https://devops.aliyun.com/projex/api/workitem/file/url?fileIdentifier=f1"></p>' }),
    } },
  ])
  const client = createClient({ token: 't', organizationId: 'o' }, { fetch, env: {} })
  const detail = await client.detail('wid')
  assert.match(detail.descriptionHtml, /<img src="https:\/\/oss\.example\/img\.png">/)
  assert.ok(!detail.descriptionHtml.includes('devops.aliyun.com'))
  assert.ok(calls.some((call) => call.url.endsWith('/workitems/wid/files/f1')))
})

test('card carries the priority custom field', () => {
  const card = cardOf({
    id: 'x',
    serialNumber: 'EVXU-1',
    customFieldValues: [
      { fieldName: '项目模块', values: [{ displayValue: '全局' }] },
      { fieldId: 'priority', fieldName: '优先级', values: [{ displayValue: '紧急' }] },
    ],
  })
  assert.equal(card.priority, '紧急')
  assert.equal(cardOf({ id: 'y', customFieldValues: [] }).priority, '')
})

test('priority filter adds a list condition on the standard field', () => {
  const body = searchBody({ spaceId: 's', category: 'Req', stages: ['1'], priority: 'high' })
  const group = JSON.parse(body.conditions).conditionGroups[0]
  const condition = group.find((entry) => entry.fieldIdentifier === 'priority')
  assert.equal(condition.value[0], '498c2c7c68879672ca3508be5e')
  assert.equal(condition.className, 'list')
  assert.equal(searchBody({ spaceId: 's', category: 'Req', stages: ['1'] }).conditions.includes('priority'), false)
})

test('phase maps onto the category status name', async () => {
  const { fetch, calls } = fakeFetch([
    { match: '/workflow', json: { statuses: [{ id: '142838', name: '开发中' }, { id: '100005', name: '待处理' }] } },
    { match: '/workitems/wid', json: { id: 'wid', categoryId: 'Req', status: { name: '待处理', id: '100005' } } },
  ])
  const client = createClient({ token: 't', organizationId: 'o' }, { fetch, env: {} })
  await client.transition({ id: 'wid', phase: 'start' })
  const put = calls.find((call) => call.init.method === 'PUT')
  assert.deepEqual(put.body, { status: '142838' })
})

test('unknown phase is rejected before any write', () => {
  assert.equal(statusForPhase('Req', 'start'), '开发中')
  assert.equal(statusForPhase('Bug', 'pushed'), '已修复')
  assert.throws(() => statusForPhase('Req', 'nope'), /未知阶段/)
})

test('organizations come from the platform endpoint, not the org-scoped projex path', async () => {
  const { fetch, calls } = fakeFetch([
    { match: '/oapi/v1/platform/organizations', json: [{ id: 'o1', name: '纷析云' }, { id: 'o2', name: '测试组织' }] },
  ])
  const list = await listOrganizations({ token: 't', organizationId: 'o1' }, { fetch, env: {} })
  assert.deepEqual(list, [{ id: 'o1', name: '纷析云' }, { id: 'o2', name: '测试组织' }])
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://openapi-rdc.aliyuncs.com/oapi/v1/platform/organizations')
  assert.equal(calls[0].init.headers['x-yunxiao-token'], 't')
})

test('organizations survive a missing org id and a wrapped response', async () => {
  const { fetch } = fakeFetch([
    { match: '/oapi/v1/platform/organizations', json: { organizations: [{ id: 'o1' }, { id: 'o1', name: '重复' }, {}] } },
  ])
  const list = await listOrganizations({ token: 't', baseUrl: 'https://acme.devops.aliyuncs.com' }, { fetch, env: {} })
  assert.deepEqual(list, [{ id: 'o1', name: 'o1' }])
})

test('organization permission errors surface without a token leak', async () => {
  const { fetch } = fakeFetch([
    { match: '/oapi/v1/platform/organizations', status: 403, json: { errorMessage: 'Current token has no permission to api.' } },
  ])
  await assert.rejects(
    listOrganizations({ token: 'secret-token' }, { fetch, env: {} }),
    (error) => error.message.includes('permission') && !error.message.includes('secret-token'),
  )
})
