/* global process */
import './isolate-env.js'
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getDefaultPerKill, getPerKillCoins, getWinningCoins } from '../lib/match-schedule.js'

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'arenacore-kill-coins-test-'))
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

async function winningCoins(userKey) {
  return Number((await db.getAdminOverview()).users.find((user) => user.user_key === userKey).winning_coins)
}

async function soloMatchWithPlayer(prefix, body = {}) {
  const signed = await signUp(request, { email: `${prefix}@test.com`, displayName: prefix, password: 'player-pass' })
  assert.equal(signed.status, 200, JSON.stringify(signed.data))
  const player = { userKey: `${prefix}@test.com`, password: signed.data.loginSecret }
  const created = await request('/api/admin/matches/create', { headers: admin, body: { mode: 'Battle Royale Solo', entryFee: 10, matchTimestamp: Date.now() + 3 * hour, ...body } })
  assert.equal(created.status, 201, JSON.stringify(created.data))
  const match = created.data.match
  await db.adjustUserBalance({ userKey: player.userKey, amount: match.entry_fee })
  const joined = await request('/api/matches/entry', { body: { ...player, matchId: match.match_id, identifiers: [`${prefix}IGN`] } })
  assert.equal(joined.status, 201, JSON.stringify(joined.data))
  return { match, player }
}

const saveKills = (match, userKey, kills) => request('/api/admin/matches/kills', { headers: admin, body: { matchId: match.match_id, kills: [{ userKey, kills }] } })

before(async () => {
  const result = await request('/api/admin/login', { body: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD } })
  admin = { authorization: `Bearer ${result.data.token}` }
})

test('Battle Royale Solo pays 4, 7 or 10 and Duo 2, 4 or 6 coins a kill for a 10, 15 or 25 coin entry, and Squad 1, 2 or 4', () => {
  assert.equal(getDefaultPerKill('Battle Royale Solo', 10), 4)
  assert.equal(getDefaultPerKill('Battle Royale Solo', 15), 7)
  assert.equal(getDefaultPerKill('Battle Royale Solo', 25), 10)
  assert.equal(getDefaultPerKill('Battle Royale Solo', 20), 7)
  assert.equal(getDefaultPerKill('Battle Royale Duo', 25), 6)
  assert.equal(getDefaultPerKill('Battle Royale Duo', 15), 4)
  assert.equal(getDefaultPerKill('Battle Royale Duo', 10), 2)
  for (const [fee, coins] of [[10, 1], [15, 2], [25, 4], [30, 4], [35, 5]]) assert.equal(getDefaultPerKill('Battle Royale Squad', fee), coins)
  assert.equal(getDefaultPerKill('Clash Squad 4v4', 15), 0)
  assert.equal(getWinningCoins({ mode: 'Battle Royale Solo', entryFee: 10 }), 0)
  assert.equal(getWinningCoins({ mode: 'Battle Royale Solo', entryFee: 10, prizePool: 50 }), 50)
  assert.equal(getWinningCoins({ mode: 'Clash Squad 1v1', entryFee: 10 }), 16)
  // The admin's rate wins, including 0 to turn kill coins off.
  assert.equal(getPerKillCoins({ mode: 'Battle Royale Solo', entryFee: 10, perKill: 6 }), 6)
  assert.equal(getPerKillCoins({ mode: 'Battle Royale Solo', entryFee: 10, perKill: 0 }), 0)
  assert.equal(getPerKillCoins({ mode: 'Battle Royale Solo', entryFee: 10, perKill: null }), 4)
})

test('saving kills pays kill coins once, and a changed count pays only the difference', async () => {
  const { match, player } = await soloMatchWithPlayer('killer')
  assert.equal(await winningCoins(player.userKey), 0)

  const first = await saveKills(match, player.userKey, 3)
  assert.equal(first.status, 200, JSON.stringify(first.data))
  assert.equal(first.data.perKill, 4)
  assert.equal(await winningCoins(player.userKey), 12)

  // Saving the same count again pays nothing more.
  await saveKills(match, player.userKey, 3)
  assert.equal(await winningCoins(player.userKey), 12)

  // Correcting the count up or down settles only the difference.
  await saveKills(match, player.userKey, 5)
  assert.equal(await winningCoins(player.userKey), 20)
  const lowered = await saveKills(match, player.userKey, 2)
  assert.equal(lowered.data.results[0].change, -12)
  assert.equal(await winningCoins(player.userKey), 8)

  // The rate is fixed once kill coins were paid.
  const changed = await request('/api/admin/matches/update', { method: 'PATCH', headers: admin, body: { matchId: match.match_id, perKill: 9 } })
  assert.equal(changed.status, 409)
})

test('the admin can set the per kill coins and the winning coins of a match', async () => {
  const { match, player } = await soloMatchWithPlayer('custom', { perKill: 6, prizePool: 300 })
  assert.equal(match.per_kill, 6)
  assert.equal(match.prize_pool, 300)
  await saveKills(match, player.userKey, 2)
  assert.equal(await winningCoins(player.userKey), 12)

  // Before any kill coins are paid the rate can change, and empty means the default again.
  const { match: other } = await soloMatchWithPlayer('reset', { perKill: 6 })
  const reset = await request('/api/admin/matches/update', { method: 'PATCH', headers: admin, body: { matchId: other.match_id, perKill: null } })
  assert.equal(reset.status, 200, JSON.stringify(reset.data))
  assert.equal(reset.data.match.per_kill, null)
})
