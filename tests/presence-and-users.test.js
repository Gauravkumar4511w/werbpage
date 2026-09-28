/* global process */
import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'arenacore-users-test-'))
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

test('presence heartbeat and live stats track real online sessions', async () => {
  const session1 = 'test-sess-1'
  const session2 = 'test-sess-2'

  const res1 = await request('/api/presence/heartbeat', {
    method: 'POST',
    body: { sessionId: session1, userKey: 'player1@test.com' },
  })
  assert.equal(res1.status, 200)
  assert.equal(res1.data.success, true)
  assert.equal(res1.data.onlineSessionsCount, 1)

  const res2 = await request('/api/presence/heartbeat', {
    method: 'POST',
    body: { sessionId: session2, userKey: 'player2@test.com' },
  })
  assert.equal(res2.status, 200)
  assert.equal(res2.data.onlineSessionsCount, 2)
  assert.ok(res2.data.liveCount >= 2)

  const stats = await request('/api/presence/stats', { method: 'GET' })
  assert.equal(stats.status, 200)
  assert.equal(stats.data.onlineSessionsCount, 2)
})

test('user registration and sync stores active users counted in admin overview', async () => {
  // Register a user
  const reg = await request('/api/users/register', {
    method: 'POST',
    body: {
      userKey: 'active-gamer@test.com',
      displayName: 'ActiveGamer',
      email: 'active-gamer@test.com',
      password: 'password123',
    },
  })
  assert.equal(reg.status, 200)
  assert.equal(reg.data.success, true)
  assert.equal(reg.data.user.status, 'active')

  // Log in as admin
  const login = await request('/api/admin/login', {
    body: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD },
  })
  assert.equal(login.status, 200)
  const token = login.data.token

  // Check admin overview
  const overview = await request('/api/admin/overview', {
    method: 'GET',
    headers: { authorization: `Bearer ${token}` },
  })
  assert.equal(overview.status, 200)
  assert.ok(overview.data.users.some((u) => u.user_key === 'active-gamer@test.com'))
  assert.ok(overview.data.activeUsersCount >= 1)

  // Admin directly creates another active user
  const adminCreate = await request('/api/admin/users/create', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: {
      userKey: 'admin-added@test.com',
      displayName: 'AdminAdded',
      email: 'admin-added@test.com',
      creditCoins: 150,
    },
  })
  assert.equal(adminCreate.status, 201)
  assert.equal(adminCreate.data.user.status, 'active')

  // Check admin overview updates active users count
  const overview2 = await request('/api/admin/overview', {
    method: 'GET',
    headers: { authorization: `Bearer ${token}` },
  })
  assert.ok(overview2.data.users.some((u) => u.user_key === 'admin-added@test.com'))
  assert.ok(overview2.data.activeUsersCount >= 2)
})
