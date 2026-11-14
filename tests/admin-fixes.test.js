/* global process */
import './isolate-env.js'
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'arenacore-admin-fixes-test-'))
process.env.DATABASE_DIR = directory
process.env.ADMIN_EMAIL = 'admin-test@example.com'
process.env.ADMIN_PASSWORD = 'test-only-private-password'
process.env.ADMIN_SESSION_SECRET = 'test-only-session-secret'
const { default: handle } = await import('../server.js')
const db = await import('../lib/payout-db.js')
const { signUp } = await import('./signup-helper.js')
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

const hour = 60 * 60 * 1000
let admin

async function makePlayer(email, displayName, password = 'player-pass') {
  const result = await signUp(request, { email, displayName, password })
  assert.equal(result.status, 200, JSON.stringify(result.data))
  return { userKey: email, password: result.data.loginSecret }
}

async function matchWithTwoPlayers(prefix) {
  const players = [await makePlayer(`${prefix}-a@test.com`, `${prefix}A`), await makePlayer(`${prefix}-b@test.com`, `${prefix}B`)]
  const match = (await request('/api/admin/matches/create', { headers: admin, body: { mode: 'Clash Squad 1v1', entryFee: 50, matchTimestamp: Date.now() + 3 * hour } })).data.match
  for (const player of players) {
    await db.adjustUserBalance({ userKey: player.userKey, amount: 50 })
    const joined = await request('/api/matches/entry', { body: { ...player, matchId: match.match_id, identifiers: [`${prefix}IGN`] } })
    assert.equal(joined.status, 201, JSON.stringify(joined.data))
  }
  return { match, players }
}

before(async () => {
  const result = await request('/api/admin/login', { body: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD } })
  admin = { authorization: `Bearer ${result.data.token}` }
})

test('the entry fee cannot change once players have paid it, so the payout matches what was collected', async () => {
  const { match, players } = await matchWithTwoPlayers('fee')
  const changed = await request('/api/admin/matches/update', { method: 'PATCH', headers: admin, body: { matchId: match.match_id, entryFee: 500 } })
  assert.equal(changed.status, 409)

  // Other settings still save.
  const room = await request('/api/admin/matches/update', { method: 'PATCH', headers: admin, body: { matchId: match.match_id, entryFee: 50, roomId: 'ROOM1' } })
  assert.equal(room.status, 200, JSON.stringify(room.data))

  await request('/api/admin/matches/confirm-result', { headers: admin, body: { matchId: match.match_id, winnerTeamNo: 1 } })
  const wallet = await request('/api/users/wallet', { body: players[0] })
  assert.equal(wallet.data.winningCoins, 80)

  // A match nobody joined can still change its fee.
  const empty = (await request('/api/admin/matches/create', { headers: admin, body: { mode: 'Clash Squad 1v1', entryFee: 50, matchTimestamp: Date.now() + 4 * hour } })).data.match
  assert.equal((await request('/api/admin/matches/update', { method: 'PATCH', headers: admin, body: { matchId: empty.match_id, entryFee: 70 } })).status, 200)
})

test('confirming a different winner for a paid match is refused instead of reported as done', async () => {
  const { match } = await matchWithTwoPlayers('again')
  assert.equal((await request('/api/admin/matches/confirm-result', { headers: admin, body: { matchId: match.match_id, winnerTeamNo: 1 } })).status, 200)
  const other = await request('/api/admin/matches/confirm-result', { headers: admin, body: { matchId: match.match_id, winnerTeamNo: 2 } })
  assert.equal(other.status, 409)
  assert.match(other.data.message, /already confirmed: team #1/)
  // Repeating the same winner is harmless and pays nothing more.
  assert.equal((await request('/api/admin/matches/confirm-result', { headers: admin, body: { matchId: match.match_id, winnerTeamNo: 1 } })).status, 200)
  const wallet = await request('/api/users/wallet', { body: { userKey: 'again-a@test.com', password: (await request('/api/users/login', { body: { login: 'again-a@test.com', password: 'player-pass' } })).data.loginSecret } })
  assert.equal(wallet.data.winningCoins, 80)
})

test('"Add active user" never overwrites an existing player', async () => {
  await makePlayer('taken@test.com', 'RealOwner', 'owner-pass')
  const created = await request('/api/admin/users/create', { headers: admin, body: { userKey: 'taken@test.com', displayName: 'Impostor', password: 'admin-set-pass', creditCoins: 100 } })
  assert.equal(created.status, 409)
  assert.equal((await request('/api/users/login', { body: { login: 'taken@test.com', password: 'owner-pass' } })).status, 200)
  assert.equal((await request('/api/users/login', { body: { login: 'taken@test.com', password: 'admin-set-pass' } })).status, 401)
  const detail = await request('/api/admin/users/detail', { method: 'GET', headers: admin, query: { userKey: 'taken@test.com' } })
  assert.equal(detail.data.user.display_name, 'RealOwner')
  assert.equal(detail.data.user.credit_coins, 0)
})

test('user details show a player online while their browser is sending heartbeats', async () => {
  await makePlayer('online@test.com', 'OnlineNow')
  await request('/api/presence/heartbeat', { body: { sessionId: 'online-tab', userKey: 'online@test.com' } })
  const detail = await request('/api/admin/users/detail', { method: 'GET', headers: admin, query: { userKey: 'online@test.com' } })
  assert.equal(detail.data.user.is_online, 1)
})
