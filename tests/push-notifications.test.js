/* global process */
import './isolate-env.js'
import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'arenacore-push-test-'))
process.env.DATABASE_DIR = directory
process.env.ADMIN_EMAIL = 'admin-test@example.com'
process.env.ADMIN_PASSWORD = 'test-only-private-password'
process.env.ADMIN_SESSION_SECRET = 'test-only-session-secret'
const { default: handle } = await import('../server.js')
const db = await import('../lib/payout-db.js')
const { setPushSender } = await import('../lib/push.js')
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

// Every notification "sent", by endpoint. Endpoints listed in `gone` answer as dropped.
let sent = []
const gone = new Set()
setPushSender(async (subscription, payload) => {
  sent.push({ endpoint: subscription.endpoint, ...JSON.parse(payload) })
  return gone.has(subscription.endpoint) ? 'gone' : 'sent'
})
beforeEach(() => { sent = [] })

let admin
const player = { userKey: '+91 95555 00001', password: 'push-player-secret' }
const other = { userKey: '+91 95555 00002', password: 'push-other-secret' }
const subscription = (name) => ({ endpoint: `https://push.example.test/${name}`, keys: { p256dh: `key-${name}`, auth: `auth-${name}` } })

before(async () => {
  const login = await request('/api/admin/login', { body: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD } })
  admin = { authorization: `Bearer ${login.data.token}` }
  for (const [index, user] of [player, other].entries()) {
    await db.registerOrUpdateUser({ userKey: user.userKey, displayName: `Push${index + 1}`, phone: user.userKey, password: user.password }, { trusted: true })
  }
})

test('a player turns notifications on for a device with their own login', async () => {
  const saved = await request('/api/push/subscribe', { body: { ...player, subscription: subscription('phone') } })
  assert.equal(saved.status, 201, JSON.stringify(saved.data))
  const wrong = await request('/api/push/subscribe', { body: { userKey: player.userKey, password: 'guess', subscription: subscription('thief') } })
  assert.notEqual(wrong.status, 201)
  const broken = await request('/api/push/subscribe', { body: { ...player, subscription: { endpoint: 'http://not-https' } } })
  assert.equal(broken.status, 400)
  await request('/api/push/subscribe', { body: { ...other, subscription: subscription('other-phone') } })
  const key = await request('/api/push/public-key', { method: 'GET' })
  assert.equal(key.status, 200)
})

test('coins added by the admin reach only that player\'s phone, after they are saved', async () => {
  const credited = await request('/api/admin/users/balance', { headers: admin, body: { userKey: player.userKey, wallet: 'credit', amount: 50, note: 'Bonus' } })
  assert.equal(credited.status, 200, JSON.stringify(credited.data))
  assert.deepEqual(sent.map((item) => item.endpoint), ['https://push.example.test/phone'])
  assert.equal(sent[0].title, 'Coins added')
  assert.match(sent[0].body, /50 coins added/)

  // Taking coins away sends nothing.
  sent = []
  await request('/api/admin/users/balance', { headers: admin, body: { userKey: player.userKey, wallet: 'credit', amount: -5, note: 'Fix' } })
  assert.equal(sent.length, 0)
})

test('an approved top-up tells the player', async () => {
  const asked = await request('/api/payments/request', { body: { ...player, amount: 20, utr: '820000000020' } })
  assert.equal(asked.status, 201, JSON.stringify(asked.data))
  sent = []
  const approved = await request('/api/admin/payments/review', { headers: admin, body: { id: asked.data.payment.id, decision: 'approve' } })
  assert.equal(approved.status, 200, JSON.stringify(approved.data))
  assert.equal(sent.length, 1)
  assert.match(sent[0].body, /20 coins added: your top-up was approved/)
})

test('posting a room tells the joined players only, without the room ID itself', async () => {
  const created = await request('/api/admin/matches/create', { headers: admin, body: { mode: 'Lone Wolf 1v1', entryFee: 10, matchTimestamp: Date.now() + 5 * 60 * 1000 } })
  const match = created.data.match
  await db.recordMatchEntry({ ...player, matchId: match.match_id, identifiers: ['PushWolf'] })
  sent = []
  const saved = await request('/api/admin/matches/update', { method: 'PATCH', headers: admin, body: { matchId: match.match_id, roomId: '7788990', roomPassword: 'pw77' } })
  assert.equal(saved.status, 200, JSON.stringify(saved.data))
  assert.deepEqual(sent.map((item) => item.endpoint), ['https://push.example.test/phone'])
  assert.equal(sent[0].title, 'Room ready')
  assert.match(sent[0].body, /are ready/)
  assert.ok(!JSON.stringify(sent).includes('7788990') && !JSON.stringify(sent).includes('pw77'))

  // Saving the same room again sends nothing new.
  sent = []
  await request('/api/admin/matches/update', { method: 'PATCH', headers: admin, body: { matchId: match.match_id, description: 'Same room' } })
  assert.equal(sent.length, 0)
})

test('a phone the browser says is gone is forgotten', async () => {
  gone.add('https://push.example.test/phone')
  await request('/api/admin/users/balance', { headers: admin, body: { userKey: player.userKey, wallet: 'credit', amount: 5, note: 'One' } })
  assert.equal(sent.length, 1)
  sent = []
  await request('/api/admin/users/balance', { headers: admin, body: { userKey: player.userKey, wallet: 'credit', amount: 5, note: 'Two' } })
  assert.equal(sent.length, 0)
  gone.clear()
})
