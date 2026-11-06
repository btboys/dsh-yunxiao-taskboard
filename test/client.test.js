import { test } from 'node:test'
import assert from 'node:assert/strict'

// client.js 是浏览器模块：用假的 module loader 和 React 在 Node 里加载，只取纯函数做行为测试
let captured = null
globalThis.window = { __ModuleLoader__: { load(module) { captured = module } } }
await import('../client.js')

const stubReact = {
  createElement: () => null,
  useEffect: () => {},
  useRef: (value) => ({ current: value ?? null }),
  useState: (value) => [typeof value === 'function' ? value() : value, () => {}],
}
const exported = captured.factory((name) => {
  if (name === 'react') return stubReact
  throw new Error(`unexpected module: ${name}`)
})
const { isHtml, hasRichMedia, editPatch, markdownToHtml, commentKind } = exported.__test

test('client edit patch only submits changed fields', () => {
  const detail = { subject: '旧标题', description: '旧描述' }
  assert.deepEqual(editPatch(detail, { subject: ' 旧标题 ', description: '旧描述', assignedTo: '' }), {})
  assert.deepEqual(editPatch(detail, { subject: '新标题', description: '旧描述', assignedTo: 'u1' }), { subject: '新标题', assignedTo: 'u1' })
  assert.deepEqual(editPatch(detail, { subject: '旧标题', description: '新描述', assignedTo: '' }), { description: '新描述' })
})

test('client leaves an empty title to the server boundary', () => {
  assert.deepEqual(editPatch({ subject: '旧', description: 'x' }, { subject: '  ', description: 'x', assignedTo: '' }), { subject: '' })
})

test('rich text and rich media detection', () => {
  assert.equal(isHtml('<p>富文本</p>'), true)
  assert.equal(isHtml('# Markdown 标题'), false)
  assert.equal(hasRichMedia('<p><img src="https://x"></p>'), true)
  assert.equal(hasRichMedia('<table><tr><td>x</td></tr></table>'), true)
  assert.equal(hasRichMedia('<p>纯文字</p>'), false)
})

test('markdown renderer escapes html and keeps lists, bold and links', () => {
  const html = markdownToHtml('- **加粗** <script>alert(1)</script>\n\n[链接](https://example.com)')
  assert.match(html, /<ul><li><strong>加粗<\/strong> &lt;script&gt;alert\(1\)&lt;\/script&gt;<\/li><\/ul>/)
  assert.match(html, /<p><a href="https:\/\/example\.com">链接<\/a><\/p>/)
})

test('comment renderer prefers contentFormat and falls back to content sniffing', () => {
  assert.equal(commentKind({ content: '  ', format: 'MARKDOWN' }), 'empty')
  assert.equal(commentKind({ content: '<p>富文本</p>', format: 'RICHTEXT' }), 'html')
  assert.equal(commentKind({ content: '# 标题', format: 'MARKDOWN' }), 'markdown')
  // 格式明确时不再按内容猜：Markdown 里的 HTML 片段仍按 Markdown 转义
  assert.equal(commentKind({ content: '<div>代码里提到 div</div>', format: 'MARKDOWN' }), 'markdown')
  assert.equal(commentKind({ content: '<p>无格式字段</p>' }), 'html')
  assert.equal(commentKind({ content: '无格式纯文本' }), 'markdown')
})
