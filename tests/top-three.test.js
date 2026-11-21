/* global process */
import './isolate-env.js'
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'arenacore-top3-test-'))
process.env.DATABASE_DIR = directory
process.env.ADMIN_EMAIL = 'admin-test@example.com'
process.env.ADMIN_PASSWORD = 'test-only-private-password'
process.env.ADMIN_SESSION_SECRET = 'test-only-session-secret'
const { default: handle } = await import('../server.js')
const db = await import('../lib/payout-db.js')
const { getScheduledMatches, getTopThreePrizes, topThreeFollowsPool } = await import('../lib/match-schedule.js')
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

const hour = 60 * 60 * 1000
let admin
const players = [1, 2, 3, 4].map((n) => ({ userKey: `+91 93333 0000${n}`, password: `top3-${n}-secret` }))
const winning = async (player) => (await db.getAuthorizedWallet(player)).winningCoins

before(async () => {
  const login = await request('/api/admin/login', { body: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD } })
  admin = { authorization: `Bearer ${login.data.token}` }
  for (const [index, player] of players.entries()) {
    await db.registerOrUpdateUser({ userKey: player.userKey, displayName: `Top${index + 1}`, phone: player.userKey, password: player.password }, { trusted: true })
    await db.adjustUserBalance({ userKey: player.userKey, amount: 500, wallet: 'credit' })
  }
})

async function paidSolo(fee = 10) {
  const created = await request('/api/admin/matches/create', { headers: admin, body: { mode: 'Battle Royale Solo', entryFee: fee, matchTimestamp: Date.now() + 2 * hour } })
  assert.equal(created.status, 201, JSON.stringify(created.data))
  const match = created.data.match
  for (const [index, player] of players.slice(0, 3).entries()) await db.recordMatchEntry({ ...player, matchId: match.match_id, identifiers: [`Place${index}x`] })
  return match
}

test('free Battle Royale pays 15 / 10 / 5, paid pays 20% / 12% / 8% of entries, and the admin can set each place', () => {
  assert.deepEqual(getTopThreePrizes({ mode: 'Battle Royale Duo', entryFee: 25, freeEntry: true, joinedTeams: 9 }), [15, 10, 5])
  assert.deepEqual(getTopThreePrizes({ mode: 'Battle Royale Solo', entryFee: 10, joinedTeams: 20 }), [40, 24, 16])
  assert.deepEqual(getTopThreePrizes({ mode: 'Battle Royale Squad', entryFee: 15, joinedTeams: 0 }), [0, 0, 0])
  assert.deepEqual(getTopThreePrizes({ mode: 'Battle Royale Solo', entryFee: 10, joinedTeams: 20, prizes: [100, null, 0] }), [100, 24, 0])
  assert.deepEqual(getTopThreePrizes({ mode: 'Clash Squad 4v4', entryFee: 15, joinedTeams: 2 }), [0, 0, 0])
  assert.equal(topThreeFollowsPool({ mode: 'Battle Royale Solo', freeEntry: false }), true)
  assert.equal(topThreeFollowsPool({ mode: 'Battle Royale Solo', freeEntry: true }), false)
  assert.equal(topThreeFollowsPool({ mode: 'Battle Royale Solo', freeEntry: false, prizes: [null, 20, null] }), false)
})

test('a paid Battle Royale result pays 1st, 2nd and 3rd from the entries collected', async () => {
  const match = await paidSolo(10)
  const before = await Promise.all(players.slice(0, 3).map(winning))
  const result = await request('/api/admin/matches/confirm-result', { headers: admin, body: { matchId: match.match_id, winnerTeamNo: 1, secondTeamNo: '#2', thirdTeamNo: 3 } })
  assert.equal(result.status, 200, JSON.stringify(result.data))
  // 3 players x 10 coins = 30 collected: 20% = 6, 12% = 3, 8% = 2.
  const after = await Promise.all(players.slice(0, 3).map(winning))
  assert.deepEqual(after.map((coins, index) => coins - before[index]), [6, 3, 2])
  assert.equal(result.data.payout.payoutPool, 11)
  assert.equal(result.data.payout.totalPool, 30)
})

test('a free Battle Royale result pays 15 / 10 / 5, and 2nd and 3rd are optional', async () => {
  const day = Date.UTC(2026, 10, 25, 1, 30) // 07:00 on 25 Nov in India, in the launch offer
  const free = getScheduledMatches(day).find((match) => match.freeEntry && match.mode === 'Battle Royale Solo')
  for (const [index, player] of players.slice(0, 3).entries()) await db.recordMatchEntry({ ...player, matchId: free.id, identifiers: [`Free${index}xx`] }, day)
  const before = await Promise.all(players.slice(0, 3).map(winning))
  const result = await request('/api/admin/matches/confirm-result', { headers: admin, body: { matchId: free.id.toLowerCase(), winnerTeamNo: 2, secondTeamNo: 3 } })
  assert.equal(result.status, 200, JSON.stringify(result.data))
  const after = await Promise.all(players.slice(0, 3).map(winning))
  // Team #2 won (15), team #3 came 2nd (10), nobody was named 3rd.
  assert.deepEqual(after.map((coins, index) => coins - before[index]), [0, 15, 10])
  assert.equal(result.data.payout.totalPool, 0)
})

test('the admin\'s place coins replace the defaults, and an empty box goes back to the default', async () => {
  const match = await paidSolo(10)
  const saved = await request('/api/admin/matches/update', { method: 'PATCH', headers: admin, body: { matchId: match.match_id, prize1: 50, prize2: '', prize3: 0 } })
  assert.equal(saved.status, 200, JSON.stringify(saved.data))
  assert.deepEqual([saved.data.match.prize_1, saved.data.match.prize_2, saved.data.match.prize_3], [50, null, 0])
  const catalog = await db.getPublicMatchCatalog()
  assert.equal(catalog.find((item) => item.match_id === match.match_id).prize_1, 50)

  const before = await Promise.all(players.slice(0, 3).map(winning))
  await request('/api/admin/matches/confirm-result', { headers: admin, body: { matchId: match.match_id, winnerTeamNo: 3, secondTeamNo: 1, thirdTeamNo: 2 } })
  const after = await Promise.all(players.slice(0, 3).map(winning))
  // 1st: the admin's 50. 2nd: default 12% of 30 = 3. 3rd: the admin's 0.
  assert.deepEqual(after.map((coins, index) => coins - before[index]), [3, 0, 50])
})

test('places must be different teams that joined the match', async () => {
  const match = await paidSolo(10)
  const same = await request('/api/admin/matches/confirm-result', { headers: admin, body: { matchId: match.match_id, winnerTeamNo: 1, secondTeamNo: 1 } })
  assert.equal(same.status, 400)
  assert.match(same.data.message, /different teams/)
  const missing = await request('/api/admin/matches/confirm-result', { headers: admin, body: { matchId: match.match_id, winnerTeamNo: 1, thirdTeamNo: 9 } })
  assert.equal(missing.status, 400)
  assert.match(missing.data.message, /no team #9/)
  // Nothing was paid by the refused attempts, so the result can still be confirmed.
  const ok = await request('/api/admin/matches/confirm-result', { headers: admin, body: { matchId: match.match_id, winnerTeamNo: 1, secondTeamNo: 2 } })
  assert.equal(ok.status, 200, JSON.stringify(ok.data))
})

test('Clash Squad and Lone Wolf keep paying only the winner', async () => {
  const created = await request('/api/admin/matches/create', { headers: admin, body: { mode: 'Clash Squad 1v1', entryFee: 10, matchTimestamp: Date.now() + 2 * hour } })
  const match = created.data.match
  for (const [index, player] of players.slice(0, 2).entries()) await db.recordMatchEntry({ ...player, matchId: match.match_id, identifiers: [`Duel${index}xx`] })
  const before = await winning(players[1])
  const result = await request('/api/admin/matches/confirm-result', { headers: admin, body: { matchId: match.match_id, winnerTeamNo: 1, secondTeamNo: 2 } })
  assert.equal(result.status, 200, JSON.stringify(result.data))
  assert.equal(result.data.payout.payoutPool, 16)
  assert.equal(await winning(players[1]), before)
})
