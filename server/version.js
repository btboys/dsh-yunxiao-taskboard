// 版本自检：读本包版本、查 npm 最新版、解析当前 profile。纯函数，便于测试。
import { readFileSync } from 'node:fs'

export const PACKAGE = 'dsh-yunxiao-taskboard'
// 国内直连 npm 官方源经常超时，和 dsh-context 一样按顺序问，先答上的为准
export const REGISTRIES = ['https://registry.npmjs.org', 'https://registry.npmmirror.com']

export function readVersion(file) {
  try {
    const version = JSON.parse(readFileSync(file, 'utf8')).version
    return typeof version === 'string' ? version : ''
  } catch {
    return ''
  }
}

export function readDependencySpec(file, name = PACKAGE) {
  try {
    const spec = JSON.parse(readFileSync(file, 'utf8'))?.dependencies?.[name]
    return typeof spec === 'string' ? spec : ''
  } catch {
    return ''
  }
}

// 本地开发安装（link/file/workspace）不给一键升级：会把开发链接替换成 npm 版本
export function isLocalSpec(spec) {
  return /^(link:|file:|workspace:)/.test(String(spec ?? '').trim())
}

function parseVersion(value) {
  // build metadata 不参与优先级比较
  const text = String(value ?? '').trim().replace(/^v/i, '').split('+', 1)[0]
  const [core = '', pre = ''] = text.split('-', 2)
  return { parts: core.split('.').map((part) => Number.parseInt(part, 10) || 0), pre }
}

// semver 预发布标识符规则：数字段按数值比，数字段优先级低于字母段，段数少的低
function comparePre(left, right) {
  const a = left.split('.')
  const b = right.split('.')
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (a[i] === undefined) return -1
    if (b[i] === undefined) return 1
    if (a[i] === b[i]) continue
    const aNumber = /^\d+$/.test(a[i])
    const bNumber = /^\d+$/.test(b[i])
    if (aNumber && bNumber) return Number(a[i]) > Number(b[i]) ? 1 : -1
    if (aNumber !== bNumber) return aNumber ? -1 : 1
    return a[i] > b[i] ? 1 : -1
  }
  return 0
}

export function compareVersions(left, right) {
  const a = parseVersion(left)
  const b = parseVersion(right)
  for (let i = 0; i < Math.max(a.parts.length, b.parts.length); i += 1) {
    const diff = (a.parts[i] || 0) - (b.parts[i] || 0)
    if (diff !== 0) return diff > 0 ? 1 : -1
  }
  // 同号时正式版高于预发布版
  if (a.pre === b.pre) return 0
  if (!a.pre) return 1
  if (!b.pre) return -1
  return comparePre(a.pre, b.pre)
}

// 注册表返回的版本号会直接拼进 pnpm 参数，只接受规整的 semver（预发布与 build 可同时存在）
export function isVersion(value) {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(String(value ?? ''))
}

export async function fetchLatest({ fetch: fetcher = globalThis.fetch, timeoutMs = 5000 } = {}) {
  for (const registry of REGISTRIES) {
    try {
      const response = await fetcher(`${registry}/${PACKAGE}/latest`, { signal: AbortSignal.timeout(timeoutMs) })
      if (!response.ok) continue
      const body = await response.json()
      if (isVersion(body?.version)) return body.version
    } catch {}
  }
  return ''
}

// profile 名会拼进文件路径和 spawn 参数，只认 DSH 的常规命名
const PROFILE_NAME = /^[a-z0-9][\w-]*$/i
const pickProfile = (value) => (PROFILE_NAME.test(String(value ?? '')) ? String(value) : '')

// `dsh web` 的 argv 是 [node, bin.js, web]；`dsh --profile x` 直接带 --profile；
// 桌面端把 profile 目录作为参数传进来。识别不了就不给升级入口，避免改错 profile。
export function resolveProfile(argv = process.argv) {
  const index = argv.indexOf('--profile')
  if (index >= 0) return pickProfile(argv[index + 1])
  const inline = argv.find((arg) => String(arg).startsWith('--profile='))
  if (inline) return pickProfile(String(inline).slice('--profile='.length))
  // `dsh <profile>` 缩写：第一个位置参数就是 profile（web / tui / 自定义）
  const first = argv[2]
  if (first && !first.startsWith('-') && PROFILE_NAME.test(first)) return first
  for (const arg of argv) {
    const found = /[\\/]profiles[\\/]([^\\/]+)/.exec(arg)
    if (found) return pickProfile(found[1])
  }
  return ''
}
