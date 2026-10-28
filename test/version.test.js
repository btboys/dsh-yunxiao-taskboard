import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compareVersions, fetchLatest, isLocalSpec, isVersion, readDependencySpec, readVersion, resolveProfile } from '../server/version.js'

test('compareVersions orders releases and prereleases', () => {
  assert.equal(compareVersions('1.2.0', '1.3.0'), -1)
  assert.equal(compareVersions('1.10.0', '1.9.9'), 1)
  assert.equal(compareVersions('v1.2.0', '1.2.0'), 0)
  assert.equal(compareVersions('2.0.0', '1.99.99'), 1)
  assert.equal(compareVersions('1.2.0-rc.1', '1.2.0'), -1)
  assert.equal(compareVersions('1.2.0', '1.2.0-rc.1'), 1)
  assert.equal(compareVersions('1.2', '1.2.0'), 0)
  // 预发布标识符按 semver 规则：数字段按数值、段数少的低、数字段低于字母段
  assert.equal(compareVersions('1.2.0-beta.9', '1.2.0-beta.10'), -1)
  assert.equal(compareVersions('1.2.0-alpha', '1.2.0-alpha.1'), -1)
  assert.equal(compareVersions('1.2.0-1', '1.2.0-alpha'), -1)
  assert.equal(compareVersions('1.2.0-rc.1+build.5', '1.2.0-rc.1'), 0)
})

test('isVersion only accepts plain semver', () => {
  assert.equal(isVersion('1.2.0'), true)
  assert.equal(isVersion('1.2.0-rc.1'), true)
  assert.equal(isVersion('1.3.0-rc.1+build.5'), true)
  assert.equal(isVersion('1.3.0+build.5'), true)
  assert.equal(isVersion('1.2'), false)
  assert.equal(isVersion('latest'), false)
  assert.equal(isVersion('1.2.0; rm -rf /'), false)
})

test('fetchLatest falls back to the mirror when the first registry fails', async () => {
  const asked = []
  const latest = await fetchLatest({
    fetch: async (url) => {
      asked.push(url)
      if (asked.length === 1) return { ok: false, json: async () => ({}) }
      return { ok: true, json: async () => ({ version: '1.3.0' }) }
    },
  })
  assert.equal(latest, '1.3.0')
  assert.deepEqual(asked, [
    'https://registry.npmjs.org/dsh-yunxiao-taskboard/latest',
    'https://registry.npmmirror.com/dsh-yunxiao-taskboard/latest',
  ])
})

test('fetchLatest tolerates network errors and bad payloads', async () => {
  const badPayload = async () => ({ ok: true, json: async () => ({ version: 'not-a-version' }) })
  assert.equal(await fetchLatest({ fetch: badPayload }), '')
  assert.equal(await fetchLatest({ fetch: async () => { throw new Error('offline') } }), '')
})

test('readVersion reads package.json and ignores unreadable files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'yx-version-'))
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: '1.2.3' }))
    assert.equal(readVersion(join(dir, 'package.json')), '1.2.3')
    assert.equal(readVersion(join(dir, 'missing.json')), '')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('readDependencySpec and isLocalSpec tell local development installs from registry ones', () => {
  const dir = mkdtempSync(join(tmpdir(), 'yx-spec-'))
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      dependencies: { 'dsh-yunxiao-taskboard': 'link:/Users/x/src/plugin' },
    }))
    assert.equal(readDependencySpec(join(dir, 'package.json')), 'link:/Users/x/src/plugin')
    assert.equal(readDependencySpec(join(dir, 'missing.json')), '')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  assert.equal(isLocalSpec('link:/Users/x/src/plugin'), true)
  assert.equal(isLocalSpec('file:/tmp/plugin.tgz'), true)
  assert.equal(isLocalSpec('workspace:*'), true)
  assert.equal(isLocalSpec('^1.2.0'), false)
  assert.equal(isLocalSpec(''), false)
})

test('resolveProfile finds the profile from web, --profile and desktop argv shapes', () => {
  assert.equal(resolveProfile(['node', '/x/bin.js', 'web']), 'web')
  assert.equal(resolveProfile(['node', '/x/bin.js', '--profile', 'tui']), 'tui')
  assert.equal(resolveProfile(['node', '/x/bin.js', '--profile=tui']), 'tui')
  assert.equal(resolveProfile(['node', '/x/bin.js', 'web', '--port', '3080']), 'web')
  assert.equal(resolveProfile(['electron', '/x/desktop-host/index.js', '/x/dsh', '/Users/x/.dsh/profiles/desktop']), 'desktop')
  assert.equal(resolveProfile(['node', '/x/bin.js', '--patch', 'p.yml']), '')
  // 非法 profile 名不返回，避免拼进路径或命令
  assert.equal(resolveProfile(['node', '/x/bin.js', '--profile', '../evil']), '')
  assert.equal(resolveProfile(['node', '/x/bin.js', '--profile', 'web 3080']), '')
  assert.equal(resolveProfile(['node', '/x/bin.js', '--profile=web;rm']), '')
})
