/* global process */
import './isolate-env.js'
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'arenacore-free-test-'))
process.env.DATABASE_DIR = directory
process.env.ADMIN_EMAIL = 'admin-test@example.com'
process.env.ADMIN_PASSWORD = 'test-only-private-password'
process.env.ADMIN_SESSION_SECRET = 'test-only-session-secret'
const { default: handle } = await import('../server.js')
const db = await import('../lib/payout-db.js')
const { getScheduledMatches, getEntryCost } = await import('../lib/match-schedule.js')
const { createClient } = await import('@libsql/client')
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

// 07:00 in India on 25 November 2026, before that day's first match at 09:00.
const offerDay = Date.UTC(2026, 10, 25, 1, 30)
let admin
const players = [1, 2].map((n) => ({ userKey: `+91 91111 0000${n}`, password: `free-${n}-secret` }))

before(async () => {
  const login = await request('/api/admin/login', { body: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD } })
  admin = { authorization: `Bearer ${login.data.token}` }
  for (const [index, player] of players.entries()) {
    await db.registerOrUpdateUser({ userKey: player.userKey, displayName: `Free${index + 1}`, phone: player.userKey, password: player.password }, { trusted: true })
    await db.adjustUserBalance({ userKey: player.userKey, amount: 100, wallet: 'credit' })
  }
})

const scheduled = (now, mode, round) => getScheduledMatches(now).filter((match) => match.mode === mode)[round]
const walletOf = (player) => db.getAuthorizedWallet(player, offerDay)
const catalogMatch = async (match) => (await db.getPublicMatchCatalog(offerDay)).find((item) => item.match_id === match.id.toLowerCase())

test('from 20 Nov to 4 Dec only each Battle Royale mode\'s first daily match is free', () => {
  const india = (day) => Date.UTC(2026, 10, day, 1, 30)
  for (const now of [india(20), offerDay, Date.UTC(2026, 11, 4, 1, 30)]) {
    const matches = getScheduledMatches(now)
    assert.equal(matches.filter((match) => match.freeEntry).length, 3)
    for (const mode of new Set(matches.map((match) => match.mode))) {
      assert.equal(scheduled(now, mode, 0).freeEntry, mode.startsWith('Battle Royale'), mode)
      assert.equal(scheduled(now, mode, 1).freeEntry, false)
    }
  }
  for (const now of [india(19), Date.UTC(2026, 11, 5, 1, 30)]) {
    assert.ok(getScheduledMatches(now).every((match) => !match.freeEntry))
  }
  assert.equal(getEntryCost({ entryFee: 25, freeEntry: true }), 0)
  assert.equal(getEntryCost({ entryFee: 25, freeEntry: false }), 25)
})

test('joining a free match takes no coins, while the same mode\'s paid match still charges', async () => {
  const free = scheduled(offerDay, 'Battle Royale Duo', 0)
  const paid = scheduled(offerDay, 'Battle Royale Duo', 1)
  const before = (await walletOf(players[0])).totalCoins

  const joined = await db.recordMatchEntry({ ...players[0], matchId: free.id, identifiers: ['FreeOne', 'FreeTwo'] }, offerDay)
  assert.equal(joined.charged, 0)
  assert.equal(joined.wallet.totalCoins, before)
  assert.equal(joined.wallet.entries.find((entry) => entry.matchId === free.id.toLowerCase()).freeEntry, true)
  assert.equal((await catalogMatch(free)).free_entry, 1)
  // The fee is kept, so the prize stays what the paid match pays.
  assert.equal((await catalogMatch(free)).entry_fee, 25)

  const charged = await db.recordMatchEntry({ ...players[0], matchId: paid.id, identifiers: ['PaidOne', 'PaidTwo'] }, offerDay)
  assert.equal(charged.charged, 25)
  assert.equal(charged.wallet.totalCoins, before - 25)
  assert.equal((await catalogMatch(paid)).free_entry, 0)
})

test('a free match pays no kill coins, only its top 3, and shows nothing collected', async () => {
  const solo = scheduled(offerDay, 'Battle Royale Solo', 0)
  assert.equal(solo.perKill, 0)
  for (const [index, player] of players.entries()) {
    await db.recordMatchEntry({ ...player, matchId: solo.id, identifiers: [`Solo${index}x`] }, offerDay)
  }
  assert.equal((await catalogMatch(solo)).per_kill, 0)
  const winningBefore = (await walletOf(players[1])).winningCoins
  const kills = await request('/api/admin/matches/kills', { headers: admin, body: { matchId: solo.id.toLowerCase(), kills: [{ userKey: players[1].userKey, kills: 3 }] } })
  assert.equal(kills.status, 200, JSON.stringify(kills.data))
  assert.equal((await walletOf(players[1])).winningCoins, winningBefore)

  // The winner gets 1st place, 15 coins, paid by the house.
  const result = await request('/api/admin/matches/confirm-result', { headers: admin, body: { matchId: solo.id.toLowerCase(), winnerTeamKey: players[1].userKey } })
  assert.equal(result.status, 200, JSON.stringify(result.data))
  assert.equal(result.data.payout.totalPool, 0)
  assert.equal((await walletOf(players[1])).winningCoins, winningBefore + 15)
})

test('free matches made before the rule get per kill 0, unless kill coins were paid or the admin set a rate', async () => {
  const day = Date.UTC(2026, 10, 27, 1, 30) // 07:00 on 27 Nov in India
  const [solo, duo, squad] = ['Battle Royale Solo', 'Battle Royale Duo', 'Battle Royale Squad'].map((mode) => scheduled(day, mode, 0))
  await db.getPublicMatchCatalog(day)
  const raw = createClient({ url: `file:${path.join(directory, 'arenacore.sqlite')}` })
  // Stored the way free matches were made before: no rate, so the paid default applied.
  await raw.execute({ sql: 'UPDATE matches SET per_kill = NULL WHERE match_id IN (?, ?, ?)', args: [solo.id.toLowerCase(), duo.id.toLowerCase(), squad.id.toLowerCase()] })
  // Kill coins were already paid in the Duo match, and the admin set 3 a kill in the Squad match.
  await raw.execute({ sql: "INSERT INTO match_kills (match_id, user_key, kills, paid) VALUES (?, 'early@test.com', 2, 12)", args: [duo.id.toLowerCase()] })
  await raw.execute({ sql: 'UPDATE matches SET per_kill = 3 WHERE match_id = ?', args: [squad.id.toLowerCase()] })
  raw.close()

  const catalog = await db.getPublicMatchCatalog(day)
  const rate = (match) => catalog.find((item) => item.match_id === match.id.toLowerCase()).per_kill
  assert.equal(rate(solo), 0)
  assert.equal(rate(duo), null)
  assert.equal(rate(squad), 3)
})

test('a free match already played keeps the kill coins its players were shown', async () => {
  const day = Date.UTC(2026, 10, 28, 1, 30) // 07:00 on 28 Nov in India
  const solo = scheduled(day, 'Battle Royale Solo', 0)
  await db.getPublicMatchCatalog(day)
  const raw = createClient({ url: `file:${path.join(directory, 'arenacore.sqlite')}` })
  await raw.execute({ sql: 'UPDATE matches SET per_kill = NULL WHERE match_id = ?', args: [solo.id.toLowerCase()] })
  raw.close()
  // Loaded after its 9:00 AM start: it stays on the default rate.
  const afterStart = await db.getPublicMatchCatalog(solo.matchTimestamp + 30 * 60 * 1000)
  assert.equal(afterStart.find((item) => item.match_id === solo.id.toLowerCase()).per_kill, null)
})

test('Clash Squad and Lone Wolf stay paid during the offer', async () => {
  const duel = scheduled(offerDay, 'Clash Squad 1v1', 0)
  const joined = await db.recordMatchEntry({ ...players[1], matchId: duel.id, identifiers: ['PaidDuel1'] }, offerDay)
  assert.equal(joined.charged, 10)
  assert.equal((await catalogMatch(duel)).free_entry, 0)
})

test('deleting a free match after people joined refunds nothing', async () => {
  const squad = scheduled(offerDay, 'Battle Royale Squad', 0)
  await db.recordMatchEntry({ ...players[1], matchId: squad.id, identifiers: ['Sq1aa', 'Sq2bb', 'Sq3cc', 'Sq4dd'] }, offerDay)
  const before = (await walletOf(players[1])).totalCoins
  const deleted = await request('/api/admin/matches/delete', { method: 'DELETE', headers: admin, body: { matchId: (await catalogMatch(squad)).public_id } })
  assert.equal(deleted.status, 200, JSON.stringify(deleted.data))
  assert.equal((await walletOf(players[1])).totalCoins, before)
})

test('the admin overview marks free matches', async () => {
  // A joined one: the overview runs on the real clock, which clears unjoined matches of later days.
  const free = scheduled(offerDay, 'Battle Royale Duo', 0)
  const overview = await db.getAdminOverview()
  assert.equal(overview.matches.find((match) => match.match_id === free.id.toLowerCase()).free_entry, 1)
})

test('a day made before the offer reached it turns free, unless someone already paid to join', async () => {
  const day = Date.UTC(2026, 10, 26, 1, 30)
  const solo = scheduled(day, 'Battle Royale Solo', 0)
  const duo = scheduled(day, 'Battle Royale Duo', 0)
  await db.getPublicMatchCatalog(day)
  // Store both as paid, the way the day's matches were made before the offer started.
  const raw = createClient({ url: `file:${path.join(directory, 'arenacore.sqlite')}` })
  await raw.execute({ sql: 'UPDATE matches SET free_entry = 0 WHERE match_id IN (?, ?)', args: [solo.id.toLowerCase(), duo.id.toLowerCase()] })
  // Someone joined the Duo match, and paid, before this update was deployed.
  await raw.execute({ sql: "INSERT INTO match_entries (match_id, team_key, user_key, identifiers, team_no) VALUES (?, ?, ?, '[]', 1)", args: [duo.id.toLowerCase(), players[0].userKey, players[0].userKey] })

  const catalog = await db.getPublicMatchCatalog(day)
  assert.equal(catalog.find((item) => item.match_id === solo.id.toLowerCase()).free_entry, 1)
  assert.equal(catalog.find((item) => item.match_id === duo.id.toLowerCase()).free_entry, 0)
  raw.close()
})
