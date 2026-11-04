/* global process */
import './isolate-env.js'
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createClient } from '@libsql/client'

// Starts from a database written before passwords were hashed, with one player's password as typed.
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'arenacore-hash-test-'))
const file = createClient({ url: `file:${path.join(directory, 'arenacore.sqlite')}` })
await file.executeMultiple(`
  CREATE TABLE users (user_key TEXT PRIMARY KEY, display_name TEXT NOT NULL DEFAULT '', credit_coins INTEGER NOT NULL DEFAULT 0,
    winning_coins INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, email TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '', password TEXT NOT NULL DEFAULT '');
  INSERT INTO users (user_key, display_name, email, password) VALUES ('old@test.com', 'OldTimer', 'old@test.com', 'typed-password');
`)
file.close()

process.env.DATABASE_DIR = directory
const { default: handle } = await import('../server.js')
const { signUp } = await import('./signup-helper.js')
const stored = async (userKey) => {
  const client = createClient({ url: `file:${path.join(directory, 'arenacore.sqlite')}` })
  const row = (await client.execute({ sql: 'SELECT password, login_secret FROM users WHERE user_key = ?', args: [userKey] })).rows[0]
  client.close()
  return row
}
after(() => fs.rmSync(directory, { recursive: true, force: true }))

async function request(url, { method = 'POST', body, headers = {} } = {}) {
  const result = {}
  await handle({ url, method, body, headers: { host: 'localhost', ...headers } }, {
    setHeader() {},
    status(code) { result.status = code; return this },
    json(data) { result.data = data },
    end() {},
  })
  return result
}
const login = (loginValue, password) => request('/api/users/login', { body: { login: loginValue, password } })
const wallet = (userKey, password) => request('/api/users/wallet', { body: { userKey, password } })

before(async () => {
  // Any request waits for start-up, which hashes the old password.
  await request('/api/presence/stats', { method: 'GET' })
})

test('start-up hashes passwords that were stored as typed, and they still work', async () => {
  const row = await stored('old@test.com')
  assert.match(row.password, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/)
  assert.ok(!row.password.includes('typed-password'))

  // A browser signed in before the change still sends the password itself.
  assert.equal((await wallet('old@test.com', 'typed-password')).status, 200)
  assert.equal((await wallet('old@test.com', 'wrong')).status, 403)

  const result = await login('old@test.com', 'typed-password')
  assert.equal(result.status, 200)
  assert.match(result.data.loginSecret, /^[0-9a-f]{64}$/)
  assert.equal((await wallet('old@test.com', result.data.loginSecret)).status, 200)
  assert.equal((await login('old@test.com', 'typed-password')).data.loginSecret, result.data.loginSecret)
})

test('new accounts store only a hash and sign in with a login secret', async () => {
  const created = await signUp(request, { email: 'fresh@test.com', displayName: 'FreshOne', password: ' spaced pass ' })
  assert.equal(created.status, 200, JSON.stringify(created.data))
  assert.match(created.data.loginSecret, /^[0-9a-f]{64}$/)
  assert.equal(created.data.user.password, undefined)
  const row = await stored('fresh@test.com')
  assert.match(row.password, /^scrypt\$/)
  assert.equal(row.login_secret, created.data.loginSecret)

  assert.equal((await wallet('fresh@test.com', created.data.loginSecret)).status, 200)
  // Passwords are kept exactly as typed, spaces included.
  assert.equal((await login('fresh@test.com', ' spaced pass ')).status, 200)
  assert.equal((await login('fresh@test.com', 'spaced pass')).status, 401)
  // The login secret is not a password.
  assert.equal((await login('fresh@test.com', created.data.loginSecret)).status, 401)
})

test('a password reset issues a new login secret and the old one stops working', async () => {
  const before = (await login('old@test.com', 'typed-password')).data.loginSecret
  const sent = await request('/api/auth/password/forgot', { body: { email: 'old@test.com' } })
  assert.equal(sent.status, 200, JSON.stringify(sent.data))
  const reset = await request('/api/auth/password/reset', { body: { email: 'old@test.com', otpToken: sent.data.otpToken, otp: sent.data.devOtp, password: 'brand-new-1' } })
  assert.equal(reset.status, 200, JSON.stringify(reset.data))
  assert.notEqual(reset.data.loginSecret, before)
  assert.equal((await wallet('old@test.com', before)).status, 403)
  assert.equal((await wallet('old@test.com', 'typed-password')).status, 403)
  assert.equal((await wallet('old@test.com', reset.data.loginSecret)).status, 200)
  assert.equal((await login('old@test.com', 'brand-new-1')).status, 200)
})
