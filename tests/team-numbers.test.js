/* global process */
import './isolate-env.js'
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createClient } from '@libsql/client'

const hour = 60 * 60 * 1000

// Starts from a database written before team numbers existed: one match that two teams joined,
// "zed" first and "amy" second, so numbering by name would get the order wrong.
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'arenacore-team-no-test-'))
const file = createClient({ url: `file:${path.join(directory, 'arenacore.sqlite')}` })
await file.executeMultiple(`
  CREATE TABLE matches (match_id TEXT PRIMARY KEY, public_id TEXT UNIQUE, mode TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '',
    entry_fee INTEGER NOT NULL CHECK (entry_fee > 0), match_timestamp INTEGER, prize_pool INTEGER, team_count INTEGER NOT NULL CHECK (team_count > 1),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'confirmed')), winner_team_key TEXT, confirmed_at TEXT);
  CREATE TABLE match_entries (match_id TEXT NOT NULL REFERENCES matches(match_id), team_key TEXT NOT NULL, user_key TEXT NOT NULL,
    PRIMARY KEY (match_id, team_key, user_key));
  INSERT INTO matches (match_id, public_id, mode, entry_fee, match_timestamp, team_count) VALUES ('old-match', '000500', 'Clash Squad 1v1', 50, ${Date.now() + 3 * hour}, 2);
  INSERT INTO match_entries (match_id, team_key, user_key) VALUES ('old-match', 'zed@test.com', 'zed@test.com');
  INSERT INTO match_entries (match_id, team_key, user_key) VALUES ('old-match', 'amy@test.com', 'amy@test.com');
`)
file.close()

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

let admin
before(async () => {
  const login = await request('/api/admin/login', { body: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD } })
  admin = { authorization: `Bearer ${login.data.token}` }
})

const overview = async () => (await request('/api/admin/overview', { method: 'GET', headers: admin })).data
const teamNumbers = async (matchId) => Object.fromEntries((await overview()).entries.filter((entry) => entry.match_id === matchId).map((entry) => [entry.user_key, entry.team_no]))

async function makePlayer(email, displayName) {
  const result = await signUp(request, { email, displayName, password: 'player-pass' })
  assert.equal(result.status, 200, JSON.stringify(result.data))
  await db.adjustUserBalance({ userKey: email, amount: 500 })
  return { userKey: email, password: result.data.loginSecret }
}

test('teams that joined before team numbers existed are numbered in the order they joined', async () => {
  assert.deepEqual(await teamNumbers('old-match'), { 'zed@test.com': 1, 'amy@test.com': 2 })
})

test('each team that joins gets the next number, and the admin declares the winner by it', async () => {
  const match = (await request('/api/admin/matches/create', { headers: admin, body: { mode: 'Clash Squad 1v1', entryFee: 50, matchTimestamp: Date.now() + 3 * hour } })).data.match
  const first = await makePlayer('first@test.com', 'FirstIn')
  const second = await makePlayer('second@test.com', 'SecondIn')
  for (const [player, name] of [[first, 'FirstIGN'], [second, 'SecondIGN']]) {
    assert.equal((await request('/api/matches/entry', { body: { ...player, matchId: match.match_id, identifiers: [name] } })).status, 201)
  }
  // Editing names keeps the number.
  await request('/api/matches/entry', { body: { ...first, matchId: match.match_id, identifiers: ['FirstRenamed'] } })
  assert.deepEqual(await teamNumbers(match.match_id), { 'first@test.com': 1, 'second@test.com': 2 })

  // The player sees their own team number.
  const wallet = await request('/api/users/wallet', { body: second })
  assert.equal(wallet.data.entries.find((entry) => entry.matchId === match.match_id).teamNo, 2)

  // A number that is not in the match is refused and pays nobody.
  const wrong = await request('/api/admin/matches/confirm-result', { headers: admin, body: { matchId: `#${match.public_id}`, winnerTeamNo: 3 } })
  assert.equal(wrong.status, 400)
  assert.match(wrong.data.message, /no team #3\. Its teams are #1 to #2/)
  assert.equal((await request('/api/admin/matches/confirm-result', { headers: admin, body: { matchId: match.match_id, winnerTeamNo: 'abc' } })).status, 400)

  const result = await request('/api/admin/matches/confirm-result', { headers: admin, body: { matchId: `#${match.public_id}`, winnerTeamNo: 2 } })
  assert.equal(result.status, 200, JSON.stringify(result.data))
  assert.equal(result.data.payout.winnerTeamKey, 'second@test.com')
  assert.equal(result.data.payout.winnerTeamNo, 2)
  assert.deepEqual(result.data.payout.payouts, [{ user_key: 'second@test.com', amount: 80 }])

  // The winnings land in the winner's wallet straight away; the other team gets nothing.
  const winner = await request('/api/users/wallet', { body: second })
  assert.equal(winner.data.winningCoins, 80)
  assert.equal(winner.data.entries.find((entry) => entry.matchId === match.match_id).won, true)
  assert.equal((await request('/api/users/wallet', { body: first })).data.winningCoins, 0)
})

test('the winner can still be given by team key', async () => {
  const match = (await request('/api/admin/matches/create', { headers: admin, body: { mode: 'Clash Squad 1v1', entryFee: 50, matchTimestamp: Date.now() + 3 * hour } })).data.match
  const player = await makePlayer('by-key@test.com', 'ByKey')
  await request('/api/matches/entry', { body: { ...player, matchId: match.match_id, identifiers: ['ByKeyIGN'] } })
  const result = await request('/api/admin/matches/confirm-result', { headers: admin, body: { matchId: match.match_id, winnerTeamKey: player.userKey } })
  assert.equal(result.status, 200, JSON.stringify(result.data))
  assert.equal(result.data.payout.winnerTeamNo, 1)
})
