/* global process */
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'arenacore-entry-test-'))
process.env.DATABASE_DIR = directory
process.env.ADMIN_EMAIL = 'admin-test@example.com'
process.env.ADMIN_PASSWORD = 'test-only-private-password'
process.env.ADMIN_SESSION_SECRET = 'test-only-session-secret'
const { default: handle } = await import('../server.js')
const db = await import('../lib/payout-db.js')
const { getScheduledMatches } = await import('../lib/match-schedule.js')
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
// 13:05 in India on 28 September 2026.
const monday = Date.UTC(2026, 8, 28, 7, 35)
let admin
const players = [1, 2, 3].map((n) => ({ userKey: `+91 90000 0000${n}`, password: `pass-${n}-secret` }))

before(async () => {
  const login = await request('/api/admin/login', { body: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD } })
  admin = { authorization: `Bearer ${login.data.token}` }
  for (const [index, player] of players.entries()) {
    await request('/api/users/register', { body: { ...player, displayName: `Player${index + 1}`, phone: player.userKey } })
    db.adjustUserBalance({ userKey: player.userKey, amount: 1000, wallet: 'credit' })
  }
})

function scheduled(now, mode, round = 1) {
  return getScheduledMatches(now).filter((match) => match.mode === mode)[round]
}

test('the schedule uses India time whatever the server time zone', () => {
  const lateNightInIndia = Date.UTC(2026, 8, 27, 20, 0) // 01:30 on 28 September in India
  for (const now of [monday, lateNightInIndia]) {
    const first = getScheduledMatches(now)[0]
    assert.equal(first.id, '2026-09-27T18:30:00.000Z-480-Battle Royale Solo')
    assert.equal(first.matchTimestamp, Date.UTC(2026, 8, 28, 2, 30)) // 08:00 in India
  }
})

test('joining works on every day, even after earlier days used the same browser numbering', () => {
  // Older builds stored numbered matches from "today"; the next day restarted at #000001 and joins
  // failed with "UNIQUE constraint failed: matches.public_id".
  const lastWeek = monday - 10 * 24 * hour
  db.getPublicMatchCatalog(lastWeek)
  for (const now of [monday, monday + 24 * hour]) {
    const match = scheduled(now, 'Battle Royale Solo')
    const result = db.recordMatchEntry({ ...players[0], matchId: match.id, identifiers: ['ShadowKite'] }, now)
    assert.equal(result.charged, 50)
    assert.ok(result.wallet.entries.some((entry) => entry.matchId === match.id.toLowerCase()))
  }
  const publicIds = db.getPublicMatchCatalog(monday).map((match) => match.public_id)
  assert.equal(new Set(publicIds).size, publicIds.length)
})

test('the catalog shows upcoming matches with a shared joined count', () => {
  const match = scheduled(monday, 'Battle Royale Solo')
  const catalog = db.getPublicMatchCatalog(monday)
  assert.ok(catalog.every((item) => item.match_timestamp >= monday - 24 * hour))
  assert.equal(catalog.find((item) => item.match_id === match.id.toLowerCase()).joined_count, 1)
})

test('matches cannot be joined after they start, when full, deleted or unknown', async () => {
  const started = scheduled(monday, 'Lone Wolf 1v1', 0)
  assert.throws(() => db.recordMatchEntry({ ...players[0], matchId: started.id, identifiers: ['ShadowKite'] }, started.matchTimestamp + 1000), /already started/)

  const duel = scheduled(monday, 'Clash Squad 1v1')
  db.recordMatchEntry({ ...players[0], matchId: duel.id, identifiers: ['PlayerOne'] }, monday)
  db.recordMatchEntry({ ...players[1], matchId: duel.id, identifiers: ['PlayerTwo'] }, monday)
  assert.throws(() => db.recordMatchEntry({ ...players[2], matchId: duel.id, identifiers: ['PlayerThree'] }, monday), /full/)

  const unknown = await request('/api/matches/entry', { body: { ...players[0], matchId: 'made-up-match', entryFee: 1 } })
  assert.equal(unknown.status, 404)

  const squad = scheduled(monday, 'Clash Squad 4v4')
  const catalogMatch = db.getPublicMatchCatalog(monday).find((item) => item.match_id === squad.id.toLowerCase())
  await request('/api/admin/matches/delete', { method: 'DELETE', headers: admin, body: { matchId: catalogMatch.public_id } })
  assert.throws(() => db.recordMatchEntry({ ...players[0], matchId: squad.id, identifiers: ['A11', 'B22', 'C33', 'D44'] }, monday), /no longer available/)
  assert.ok(!db.getPublicMatchCatalog(monday).some((item) => item.match_id === squad.id.toLowerCase()))
})

test('each mode asks for one name per team member and names can be edited until an hour before', () => {
  const duo = scheduled(monday, 'Battle Royale Duo')
  assert.throws(() => db.recordMatchEntry({ ...players[1], matchId: duo.id, identifiers: ['OnlyOne'] }, monday), /all 2/)
  const joined = db.recordMatchEntry({ ...players[1], matchId: duo.id, identifiers: ['Alpha01', 'Bravo02'] }, monday)
  assert.equal(joined.charged, 100)

  const edited = db.recordMatchEntry({ ...players[1], matchId: duo.id, identifiers: ['Alpha01', 'Charlie3'] }, monday)
  assert.equal(edited.charged, 0)
  assert.deepEqual(edited.wallet.entries.find((entry) => entry.matchId === duo.id.toLowerCase()).identifiers, ['Alpha01', 'Charlie3'])
  assert.throws(() => db.recordMatchEntry({ ...players[1], matchId: duo.id, identifiers: ['Late1', 'Late2'] }, duo.matchTimestamp - 30 * 60 * 1000), /locked/)

  const overview = db.getAdminOverview()
  assert.deepEqual(overview.entries.find((entry) => entry.match_id === duo.id.toLowerCase()).identifiers, ['Alpha01', 'Charlie3'])
})

test('room details set by the admin reach joined players 10 minutes before the start', async () => {
  const duo = scheduled(monday, 'Battle Royale Duo')
  const catalogMatch = db.getPublicMatchCatalog(monday).find((item) => item.match_id === duo.id.toLowerCase())
  const saved = await request('/api/admin/matches/update', { method: 'PATCH', headers: admin, body: { publicId: catalogMatch.public_id, roomId: '4455667', roomPassword: 'ff123' } })
  assert.equal(saved.status, 200)

  const entryAt = (now) => db.getAuthorizedWallet(players[1], now).entries.find((entry) => entry.matchId === duo.id.toLowerCase())
  assert.equal(entryAt(duo.matchTimestamp - hour).roomId, '')
  assert.equal(entryAt(duo.matchTimestamp - 5 * 60 * 1000).roomId, '4455667')
  assert.equal(entryAt(duo.matchTimestamp - 5 * 60 * 1000).roomPassword, 'ff123')
})

test('players can log in on another device with the number typed differently', async () => {
  const phoneLogin = await request('/api/users/login', { body: { login: '9000000001', password: players[0].password } })
  assert.equal(phoneLogin.status, 200)
  assert.equal(phoneLogin.data.user.userKey, players[0].userKey)
  assert.equal(phoneLogin.data.user.name, 'Player1')

  const wrong = await request('/api/users/login', { body: { login: '9000000001', password: 'guess' } })
  assert.equal(wrong.status, 401)
})

test('re-registering a number cannot replace its password or undo a deactivation', async () => {
  const takeover = await request('/api/users/register', { body: { userKey: players[0].userKey, password: 'attacker-pass' } })
  assert.equal(takeover.status, 409)
  const wallet = await request('/api/users/wallet', { body: players[0] })
  assert.equal(wallet.status, 200)

  await request('/api/admin/users/status', { method: 'PATCH', headers: admin, body: { userKey: players[2].userKey, status: 'inactive' } })
  await request('/api/users/sync', { body: { users: [{ userKey: players[2].userKey, name: 'Player3', password: players[2].password, status: 'active' }, { userKey: players[0].userKey, password: 'stale' }] } })
  const detail = await request('/api/admin/users/detail', { method: 'GET', headers: admin, query: { userKey: players[2].userKey } })
  assert.equal(detail.data.user.status, 'inactive')
})

test('the default prize pool counts the teams that actually joined', async () => {
  const created = await request('/api/admin/matches/create', { headers: admin, body: { mode: 'Battle Royale Solo', entryFee: 100, matchTimestamp: Date.now() + 2 * hour } })
  const match = created.data.match
  for (const [index, player] of players.entries()) {
    await request('/api/matches/entry', { body: { ...player, matchId: match.match_id, identifiers: [`Solo${index}`] } })
  }
  const result = await request('/api/admin/matches/confirm-result', { headers: admin, body: { matchId: match.match_id, winnerTeamKey: players[0].userKey } })
  assert.equal(result.status, 200, JSON.stringify(result.data))
  assert.equal(result.data.payout.totalPool, 300)
  assert.equal(result.data.payout.payoutPool, 240)
})

test('players can change their gamer tag, email and mobile number and log in with the new ones', async () => {
  const saved = await request('/api/users/profile', { body: { ...players[1], displayName: 'RenamedTwo', email: 'two@gmail.com', phone: '+91 98888 77777' } })
  assert.equal(saved.status, 200, JSON.stringify(saved.data))
  assert.deepEqual(saved.data.user, { userKey: players[1].userKey, name: 'RenamedTwo', email: 'two@gmail.com', phone: '+91 98888 77777' })

  for (const login of ['two@gmail.com', '9888877777']) {
    const result = await request('/api/users/login', { body: { login, password: players[1].password } })
    assert.equal(result.data.user.userKey, players[1].userKey)
  }
  const wallet = await request('/api/users/wallet', { body: players[1] })
  assert.equal(wallet.data.profile.name, 'RenamedTwo')

  // A browser with an old copy of the account must not undo the edit.
  await request('/api/users/sync', { body: { users: [{ userKey: players[1].userKey, name: 'Player2', phone: players[1].userKey, password: players[1].password }] } })
  const afterSync = await request('/api/users/wallet', { body: players[1] })
  assert.equal(afterSync.data.profile.name, 'RenamedTwo')
  assert.equal(afterSync.data.profile.email, 'two@gmail.com')
})

test('profile edits need the password, stay unique and keep a way to log in', async () => {
  const change = (player, body) => request('/api/users/profile', { body: { ...player, displayName: 'Player1', email: '', phone: player.userKey, ...body } })
  assert.equal((await change({ ...players[0], password: 'wrong' }, {})).status, 403)
  assert.equal((await change(players[0], { displayName: 'renamedtwo' })).status, 409)
  assert.equal((await change(players[0], { email: 'TWO@gmail.com' })).status, 409)
  assert.equal((await change(players[0], { phone: '09888877777' })).status, 409)
  assert.equal((await change(players[0], { email: '', phone: '' })).status, 400)
  assert.equal((await change(players[0], { phone: '12' })).status, 400)

  const signup = await request('/api/users/register', { body: { userKey: 'two@gmail.com', email: 'two@gmail.com', password: 'someone-else' } })
  assert.equal(signup.status, 409)
})
