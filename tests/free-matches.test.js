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

// 07:00 in India on 25 November 2026, before that day's first match at 08:00.
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

test('from 21 Nov to 4 Dec each mode\'s first daily match is free, and only that one', () => {
  const india = (day) => Date.UTC(2026, 10, day, 1, 30)
  for (const now of [india(21), offerDay, Date.UTC(2026, 11, 4, 1, 30)]) {
    const matches = getScheduledMatches(now)
    assert.equal(matches.filter((match) => match.freeEntry).length, 7)
    for (const mode of new Set(matches.map((match) => match.mode))) {
      assert.equal(scheduled(now, mode, 0).freeEntry, true)
      assert.equal(scheduled(now, mode, 1).freeEntry, false)
    }
  }
  for (const now of [india(20), Date.UTC(2026, 11, 5, 1, 30)]) {
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

test('a free match still pays its winner the normal prize, and shows nothing collected', async () => {
  const duel = scheduled(offerDay, 'Clash Squad 1v1', 0)
  for (const [index, player] of players.entries()) {
    await db.recordMatchEntry({ ...player, matchId: duel.id, identifiers: [`Duel${index}x`] }, offerDay)
  }
  const winningBefore = (await walletOf(players[1])).winningCoins
  const result = await request('/api/admin/matches/confirm-result', { headers: admin, body: { matchId: duel.id.toLowerCase(), winnerTeamKey: players[1].userKey } })
  assert.equal(result.status, 200, JSON.stringify(result.data))
  // 10 coins x 2 players x 80%, paid by the house.
  assert.equal(result.data.payout.payoutPool, 16)
  assert.equal(result.data.payout.totalPool, 0)
  assert.equal(result.data.payout.platformMargin, -16)
  assert.equal((await walletOf(players[1])).winningCoins, winningBefore + 16)
})

test('deleting a free match after people joined refunds nothing', async () => {
  const wolf = scheduled(offerDay, 'Lone Wolf 1v1', 0)
  await db.recordMatchEntry({ ...players[1], matchId: wolf.id, identifiers: ['LoneWolfX'] }, offerDay)
  const before = (await walletOf(players[1])).totalCoins
  const deleted = await request('/api/admin/matches/delete', { method: 'DELETE', headers: admin, body: { matchId: (await catalogMatch(wolf)).public_id } })
  assert.equal(deleted.status, 200, JSON.stringify(deleted.data))
  assert.equal((await walletOf(players[1])).totalCoins, before)
})

test('the admin overview marks free matches', async () => {
  // A joined one: the overview runs on the real clock, which clears unjoined matches of later days.
  const free = scheduled(offerDay, 'Battle Royale Duo', 0)
  const overview = await db.getAdminOverview()
  assert.equal(overview.matches.find((match) => match.match_id === free.id.toLowerCase()).free_entry, 1)
})
