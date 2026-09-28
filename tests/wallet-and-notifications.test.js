/* global process */
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'arenacore-wallet-test-'))
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

let admin
const player = { userKey: 'wallet-player@test.com', password: 'secret123' }

before(async () => {
  const login = await request('/api/admin/login', { body: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD } })
  admin = { authorization: `Bearer ${login.data.token}` }
  await request('/api/users/register', { body: { ...player, displayName: 'WalletPlayer', email: player.userKey } })
})

test('a UTR top-up notifies the admin and credits coins only after approval', async () => {
  const submitted = await request('/api/payments/request', { body: { ...player, amount: 500, utr: '412345678901' } })
  assert.equal(submitted.status, 201)
  assert.equal(submitted.data.payment.status, 'pending')

  const notifications = await request('/api/admin/notifications', { method: 'GET', headers: admin })
  const notice = notifications.data.notifications.find((item) => item.reference_id === submitted.data.payment.id)
  assert.equal(notice.type, 'payment')
  assert.match(notice.body, /412345678901/)
  assert.ok(notifications.data.unreadNotifications >= 1)

  let wallet = await request('/api/users/wallet', { body: player })
  assert.equal(wallet.data.creditCoins, 0)

  const approved = await request('/api/admin/payments/review', { headers: admin, body: { id: submitted.data.payment.id, decision: 'approve' } })
  assert.equal(approved.status, 200)
  assert.equal(approved.data.user.credit_coins, 500)

  const again = await request('/api/admin/payments/review', { headers: admin, body: { id: submitted.data.payment.id, decision: 'approve' } })
  assert.equal(again.status, 409)

  wallet = await request('/api/users/wallet', { body: player })
  assert.equal(wallet.data.creditCoins, 500)
  assert.equal(wallet.data.payments[0].status, 'approved')

  const after = await request('/api/admin/notifications', { method: 'GET', headers: admin })
  assert.ok(after.data.notifications.find((item) => item.id === notice.id).read_at)
})

test('the same UTR cannot be claimed twice and bad UTRs are refused', async () => {
  const duplicate = await request('/api/payments/request', { body: { ...player, amount: 500, utr: '412345678901' } })
  assert.equal(duplicate.status, 409)
  const invalid = await request('/api/payments/request', { body: { ...player, amount: 500, utr: 'x' } })
  assert.equal(invalid.status, 400)
  const tooSmall = await request('/api/payments/request', { body: { ...player, amount: 10, utr: '999999999999' } })
  assert.equal(tooSmall.status, 400)
})

test('rejected top-ups add nothing', async () => {
  const submitted = await request('/api/payments/request', { body: { ...player, amount: 200, utr: '500000000001' } })
  const rejected = await request('/api/admin/payments/review', { headers: admin, body: { id: submitted.data.payment.id, decision: 'reject', note: 'UTR not found' } })
  assert.equal(rejected.data.payment.status, 'rejected')
  assert.equal(rejected.data.user.credit_coins, 500)
})

test('admin can look a user up by key, email or gamer tag and see the ledger', async () => {
  for (const query of [player.userKey, 'WALLET-PLAYER@TEST.COM', 'walletplayer']) {
    const detail = await request(`/api/admin/users/detail?userKey=${encodeURIComponent(query)}`, { method: 'GET', headers: admin })
    assert.equal(detail.status, 200)
    assert.equal(detail.data.user.user_key, player.userKey)
    assert.equal(detail.data.user.password, undefined)
  }
  const detail = await request('/api/admin/users/detail', { method: 'GET', headers: admin, query: { userKey: player.userKey } })
  assert.equal(detail.data.totals.approvedTopups, 500)
  assert.equal(detail.data.transactions[0].reason, 'topup_approved')

  const missing = await request('/api/admin/users/detail?userKey=nobody@test.com', { method: 'GET', headers: admin })
  assert.equal(missing.status, 404)
  const anonymous = await request(`/api/admin/users/detail?userKey=${player.userKey}`, { method: 'GET' })
  assert.equal(anonymous.status, 401)
})

test('admin can add and deduct either wallet but never below zero', async () => {
  const added = await request('/api/admin/users/balance', { headers: admin, body: { userKey: player.userKey, wallet: 'winning', amount: 300, note: 'Bonus' } })
  assert.equal(added.status, 200)
  assert.equal(added.data.user.winning_coins, 300)

  const deducted = await request('/api/admin/users/balance', { headers: admin, body: { userKey: player.userKey, wallet: 'credit', amount: -100, note: 'Correction' } })
  assert.equal(deducted.data.user.credit_coins, 400)

  const overdraw = await request('/api/admin/users/balance', { headers: admin, body: { userKey: player.userKey, wallet: 'winning', amount: -301 } })
  assert.equal(overdraw.status, 400)
  const wallet = await request('/api/users/wallet', { body: player })
  assert.equal(wallet.data.winningCoins, 300)
  assert.equal(wallet.data.creditCoins, 400)
})

test('wallet access needs the account password once one is stored', async () => {
  const wrong = await request('/api/users/wallet', { body: { userKey: player.userKey, password: 'nope' } })
  assert.equal(wrong.status, 403)
  const spend = await request('/api/matches/entry', { body: { userKey: player.userKey, password: 'nope', matchId: 'm-1', entryFee: 50 } })
  assert.equal(spend.status, 403)
})

test('joining a match charges the stored fee once, and deleting the match refunds it', async () => {
  const created = await request('/api/admin/matches/create', { headers: admin, body: { mode: 'Clash Squad 1v1', entryFee: 450, matchTimestamp: Date.now() + 86400000 } })
  const match = created.data.match
  // The browser claims a lower fee; the stored 450 is charged: 400 credit, then 50 winning.
  const joined = await request('/api/matches/entry', { body: { ...player, matchId: match.match_id, publicId: match.public_id, entryFee: 1 } })
  assert.equal(joined.status, 201)
  assert.equal(joined.data.charged, 450)
  assert.equal(joined.data.wallet.creditCoins, 0)
  assert.equal(joined.data.wallet.winningCoins, 250)

  const rejoined = await request('/api/matches/entry', { body: { ...player, matchId: match.match_id, entryFee: 450 } })
  assert.equal(rejoined.data.charged, 0)

  const deleted = await request('/api/admin/matches/delete', { method: 'DELETE', headers: admin, body: { matchId: match.public_id } })
  assert.equal(deleted.status, 200, JSON.stringify(deleted.data))
  assert.equal(deleted.data.refunds, 2)
  const wallet = await request('/api/users/wallet', { body: player })
  assert.equal(wallet.data.creditCoins, 400)
  assert.equal(wallet.data.winningCoins, 300)
})

test('withdrawals hold winning coins, notify the admin and refund on rejection', async () => {
  const requested = await request('/api/withdrawals/request', { body: { ...player, amount: 100, method: 'upi', details: { upiId: 'p@upi' } } })
  assert.equal(requested.status, 201)
  assert.equal(requested.data.wallet.winningCoins, 200)

  const tooMuch = await request('/api/withdrawals/request', { body: { ...player, amount: 5000, method: 'upi' } })
  assert.equal(tooMuch.status, 400)

  const notifications = await request('/api/admin/notifications', { method: 'GET', headers: admin })
  assert.ok(notifications.data.notifications.some((item) => item.type === 'withdrawal' && item.reference_id === requested.data.id))

  const rejected = await request('/api/admin/withdrawals/review', { headers: admin, body: { id: requested.data.id, decision: 'reject' } })
  assert.equal(rejected.data.user.winning_coins, 300)
})

test('re-syncing browser users never changes balances', async () => {
  await request('/api/users/sync', { body: { users: [{ email: player.userKey, name: 'WalletPlayer', password: player.password, coins: 99999 }] } })
  const wallet = await request('/api/users/wallet', { body: player })
  assert.equal(wallet.data.creditCoins, 400)
})

test('mark all notifications read', async () => {
  const cleared = await request('/api/admin/notifications/read', { headers: admin, body: {} })
  assert.equal(cleared.data.unreadNotifications, 0)
})
