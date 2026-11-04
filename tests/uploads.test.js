/* global process, Buffer */
import './isolate-env.js'
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'arenacore-uploads-test-'))
process.env.DATABASE_DIR = directory
process.env.ADMIN_EMAIL = 'admin@test.com'
process.env.ADMIN_PASSWORD = 'test-only-private-password'
process.env.ADMIN_SESSION_SECRET = 'test-only-session-secret'
const { default: handle } = await import('../server.js')
const db = await import('../lib/payout-db.js')
const { signUp } = await import('./signup-helper.js')
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

// A real 1×1 PNG, as the browser sends it after shrinking the screenshot.
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
let player
let admin

before(async () => {
  const created = await signUp(request, { email: 'uploader@test.com', displayName: 'Uploader', password: 'secret123' })
  player = { userKey: 'uploader@test.com', password: created.data.loginSecret }
  await db.adjustUserBalance({ userKey: player.userKey, amount: 500, wallet: 'winning' })
  const login = await request('/api/admin/login', { body: { email: 'admin@test.com', password: process.env.ADMIN_PASSWORD } })
  admin = { authorization: `Bearer ${login.data.token}` }
})

const upload = (kind, id, headers = admin) => request(`/api/admin/uploads?kind=${kind}&id=${id}`, { method: 'GET', headers })

test('a top-up screenshot reaches the Admin Desk', async () => {
  const sent = await request('/api/payments/request', { body: { ...player, amount: 100, utr: 'SHOT12345678', screenshot: png } })
  assert.equal(sent.status, 201, JSON.stringify(sent.data))
  const id = sent.data.payment.id

  const overview = await request('/api/admin/overview', { method: 'GET', headers: admin })
  const row = overview.data.payments.find((payment) => payment.id === id)
  assert.equal(row.has_screenshot, 1)
  assert.equal(JSON.stringify(overview.data).includes('iVBORw0KGgo'), false)

  const shot = await upload('payment', id)
  assert.equal(shot.status, 200)
  assert.equal(shot.data.dataUrl, png)

  const detail = await request('/api/admin/users/detail?userKey=uploader@test.com', { method: 'GET', headers: admin })
  assert.equal(detail.data.payments.find((payment) => payment.id === id).has_screenshot, 1)

  assert.equal((await upload('payment', id, {})).status, 401)
})

test('only real, small images are accepted, and a bad one stops the request', async () => {
  const fake = `data:image/png;base64,${Buffer.from('<script>alert(1)</script>').toString('base64')}`
  const huge = `data:image/jpeg;base64,${Buffer.concat([Buffer.from('ffd8ffe0', 'hex'), Buffer.alloc(2.5 * 1024 * 1024)]).toString('base64')}`
  for (const [screenshot, message] of [[fake, /not a valid image/], [huge, /smaller than 2 MB/], ['data:text/html;base64,PGI+', /PNG, JPG or WebP/]]) {
    const result = await request('/api/payments/request', { body: { ...player, amount: 100, utr: `BAD${Math.random().toString(36).slice(2, 10).toUpperCase()}`, screenshot } })
    assert.equal(result.status, 400)
    assert.match(result.data.message, message)
  }
  const overview = await request('/api/admin/overview', { method: 'GET', headers: admin })
  assert.equal(overview.data.payments.filter((payment) => payment.user_key === player.userKey).length, 1)
})

test('a top-up without a screenshot still works and says so', async () => {
  const sent = await request('/api/payments/request', { body: { ...player, amount: 50, utr: 'NOSHOT123456' } })
  assert.equal(sent.status, 201)
  assert.equal((await upload('payment', sent.data.payment.id)).status, 404)
})

test('UPI withdrawals need the account name, and the QR reaches the Admin Desk', async () => {
  const missingName = await request('/api/withdrawals/request', { body: { ...player, amount: 100, method: 'upi', details: { upiId: 'up@upi' } } })
  assert.equal(missingName.status, 400)
  assert.match(missingName.data.message, /name on your UPI/)

  const sent = await request('/api/withdrawals/request', { body: { ...player, amount: 100, method: 'upi', details: { upiId: ' up@upi ', upiName: ' Uploader Kumar ', qrScreenshotName: 'old.png', extra: 'dropped' }, qrScreenshot: png } })
  assert.equal(sent.status, 201, JSON.stringify(sent.data))
  const overview = await request('/api/admin/overview', { method: 'GET', headers: admin })
  const row = overview.data.withdrawals.find((withdrawal) => withdrawal.id === sent.data.id)
  assert.deepEqual(JSON.parse(row.details), { upiId: 'up@upi', upiName: 'Uploader Kumar' })
  assert.equal(row.has_screenshot, 1)
  assert.equal((await upload('withdrawal', sent.data.id)).data.dataUrl, png)

  const badBank = await request('/api/withdrawals/request', { body: { ...player, amount: 100, method: 'bank', details: { accountName: 'U', accountNumber: '12', ifsc: 'x' } } })
  assert.equal(badBank.status, 400)
})
