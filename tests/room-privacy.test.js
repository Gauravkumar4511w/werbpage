/* global process */
import './isolate-env.js'
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'arenacore-room-test-'))
process.env.DATABASE_DIR = directory
process.env.ADMIN_EMAIL = 'admin-test@example.com'
process.env.ADMIN_PASSWORD = 'test-only-private-password'
process.env.ADMIN_SESSION_SECRET = 'test-only-session-secret'
const { default: handle } = await import('../server.js')
const db = await import('../lib/payout-db.js')
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

let admin
let match
const joined = { userKey: '+91 94444 00001', password: 'room-joined-secret' }
const outsider = { userKey: '+91 94444 00002', password: 'room-outsider-secret' }

before(async () => {
  const login = await request('/api/admin/login', { body: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD } })
  admin = { authorization: `Bearer ${login.data.token}` }
  for (const [index, player] of [joined, outsider].entries()) {
    await db.registerOrUpdateUser({ userKey: player.userKey, displayName: `Room${index + 1}`, phone: player.userKey, password: player.password }, { trusted: true })
    await db.adjustUserBalance({ userKey: player.userKey, amount: 100, wallet: 'credit' })
  }
  // Starts in 5 minutes, so the room details are already due.
  const created = await request('/api/admin/matches/create', { headers: admin, body: { mode: 'Clash Squad 1v1', entryFee: 10, matchTimestamp: Date.now() + 5 * 60 * 1000 } })
  match = created.data.match
  await db.recordMatchEntry({ ...joined, matchId: match.match_id, identifiers: ['RoomJoiner'] })
  const saved = await request('/api/admin/matches/update', { method: 'PATCH', headers: admin, body: { matchId: match.match_id, roomId: '5566778', roomPassword: 'ff999' } })
  assert.equal(saved.status, 200, JSON.stringify(saved.data))
})

test('the player who joined gets the room ID and password', async () => {
  const wallet = await request('/api/users/wallet', { body: joined })
  const entry = wallet.data.entries.find((item) => item.matchId === match.match_id)
  assert.equal(entry.roomId, '5566778')
  assert.equal(entry.roomPassword, 'ff999')
})

test('the public match list never carries room details', async () => {
  const listed = await request('/api/matches/catalog', { method: 'GET' })
  assert.equal(listed.status, 200)
  const text = JSON.stringify(listed.data)
  assert.ok(!text.includes('5566778') && !text.includes('ff999'))
  const item = listed.data.matches.find((row) => row.match_id === match.match_id)
  assert.ok(item && !('room_id' in item) && !('room_password' in item))
})

test('a player who did not join never gets them', async () => {
  const wallet = await request('/api/users/wallet', { body: outsider })
  assert.equal(wallet.status, 200)
  assert.ok(!JSON.stringify(wallet.data).includes('5566778'))
  assert.ok(!wallet.data.entries.some((item) => item.matchId === match.match_id))
})

test('nobody gets them by asking for the joined player\'s entries with a wrong password', async () => {
  const wrong = await request('/api/users/wallet', { body: { userKey: joined.userKey, password: outsider.password } })
  assert.notEqual(wrong.status, 200)
  assert.ok(!JSON.stringify(wrong.data || {}).includes('5566778'))
})
