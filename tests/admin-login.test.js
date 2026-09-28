/* global process */
import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { signAdminSession, verifySignedAdminSession } from '../lib/admin-session.js'

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'arenacore-login-test-'))
process.env.DATABASE_DIR = directory
process.env.ADMIN_EMAIL = 'admin-test@example.com'
process.env.ADMIN_PASSWORD = 'test-only-private-password'
process.env.ADMIN_SESSION_SECRET = 'test-only-session-secret'
const { default: handle } = await import('../server.js')
after(() => fs.rmSync(directory, { recursive: true, force: true }))

async function request(url, { method = 'POST', body, headers = {}, query } = {}) {
  const result = {}
  await handle({ url, method, body, headers: { host: 'localhost', ...headers }, query }, {
    setHeader() {},
    status(code) { result.status = code; return this },
    json(data) { result.data = data },
    end() {},
  })
  return result
}

const credentials = { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }

test('login routes work directly and through deployment rewrites', async () => {
  for (const [url, options] of [
    ['/api/admin/login', {}],
    ['/api/index?_api_path=admin/login', {}],
    ['/api/index', { query: { _api_path: 'admin/login' } }],
    ['/api/admin/login', { headers: { 'x-matched-path': '/api/[...path]' } }],
  ]) {
    const login = await request(url, { ...options, body: credentials })
    assert.equal(login.status, 200)
    const overview = await request('/api/admin/overview', { method: 'GET', headers: { authorization: `Bearer ${login.data.token}` } })
    assert.equal(overview.status, 200)
    assert.ok(Array.isArray(overview.data.matches))
  }
})

test('invalid credentials and unauthenticated dashboard requests are rejected', async () => {
  assert.equal((await request('/api/admin/login', { body: { ...credentials, password: 'wrong' } })).status, 401)
  assert.equal((await request('/api/admin/overview', { method: 'GET' })).status, 401)
})

test('signed sessions reject tampering, expired tokens, and changed secrets', () => {
  const token = signAdminSession('private-secret', 2000)
  assert.equal(verifySignedAdminSession(token, 'private-secret', 1000), true)
  assert.equal(verifySignedAdminSession(token, 'private-secret', 2000), false)
  assert.equal(verifySignedAdminSession(token, 'other-secret', 1000), false)
  const parts = token.split('.')
  parts[1] = parts[1].slice(0, -1) + 'A'
  assert.equal(verifySignedAdminSession(parts.join('.'), 'private-secret', 1000), false)
  assert.equal(verifySignedAdminSession(`${token}.extra`, 'private-secret', 1000), false)
  assert.equal(verifySignedAdminSession('v1.bad.x', 'private-secret', 1000), false)
})

test('login sessions work on another API process with a separate SQLite database', async () => {
  const login = await request('/api/admin/login', { body: credentials })
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', `
    const { default: handle } = await import('./server.js');
    await handle({ method: 'GET', url: '/api/admin/overview', headers: { host: 'localhost', authorization: 'Bearer ' + process.env.TEST_ADMIN_TOKEN } }, {
      setHeader() {}, status(code) { process.stdout.write(String(code)); return this; }, json() {}, end() {}
    });
  `], { env: { ...process.env, DATABASE_DIR: path.join(directory, 'second-instance'), TEST_ADMIN_TOKEN: login.data.token }, encoding: 'utf8' })
  assert.equal(output, '200')
})
