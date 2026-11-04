/* global process */
import './isolate-env.js'
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createClient } from '@libsql/client'
import { getScheduledMatches } from '../lib/match-schedule.js'

const hour = 60 * 60 * 1000
// 12:00 noon in India on Wednesday 4 November 2026.
const now = Date.UTC(2026, 10, 4, 6, 30)
const today = '2026-11-04'
const tomorrow = '2026-11-05'

// Starts from a database made when five days were scheduled at once, numbered 000001, 000002...
// Somebody already joined one of tomorrow's matches, so that one must stay.
const old = getScheduledMatches(now, 2)
const joinedTomorrow = old[14 + 4]
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'arenacore-daily-test-'))
const file = createClient({ url: `file:${path.join(directory, 'arenacore.sqlite')}` })
await file.executeMultiple(`
  CREATE TABLE matches (match_id TEXT PRIMARY KEY, public_id TEXT UNIQUE, mode TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '',
    entry_fee INTEGER NOT NULL CHECK (entry_fee > 0), match_timestamp INTEGER, prize_pool INTEGER, team_count INTEGER NOT NULL CHECK (team_count > 1),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'confirmed')), winner_team_key TEXT, confirmed_at TEXT);
  CREATE TABLE match_entries (match_id TEXT NOT NULL REFERENCES matches(match_id), team_key TEXT NOT NULL, user_key TEXT NOT NULL,
    PRIMARY KEY (match_id, team_key, user_key));
  ${old.map((match, index) => `INSERT INTO matches (match_id, public_id, mode, entry_fee, match_timestamp, team_count) VALUES ('${match.id.toLowerCase()}', '${String(index + 1).padStart(6, '0')}', '${match.mode}', ${match.entryFee}, ${match.matchTimestamp}, 2);`).join('\n')}
  INSERT INTO match_entries (match_id, team_key, user_key) VALUES ('${joinedTomorrow.id.toLowerCase()}', 'early@test.com', 'early@test.com');
`)
file.close()

process.env.DATABASE_DIR = directory
process.env.ADMIN_EMAIL = 'admin-test@example.com'
process.env.ADMIN_PASSWORD = 'test-only-private-password'
process.env.ADMIN_SESSION_SECRET = 'test-only-session-secret'
const { default: handle } = await import('../server.js')
const db = await import('../lib/payout-db.js')
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

let admin
before(async () => {
  const login = await request('/api/admin/login', { body: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD } })
  admin = { authorization: `Bearer ${login.data.token}` }
})

test('only today\'s matches are kept, numbered #01 to #14 in start order', async () => {
  const catalog = await db.getPublicMatchCatalog(now)
  const todays = catalog.filter((match) => match.match_day === today)
  assert.equal(todays.length, 14)
  assert.deepEqual(todays.map((match) => match.day_no), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14])
  const times = todays.map((match) => match.match_timestamp)
  assert.deepEqual(times, [...times].sort((a, b) => a - b))
  // The 1:20 AM match after midnight still belongs to today's schedule.
  assert.equal(todays.at(-1).match_timestamp, Date.UTC(2026, 10, 4, 19, 50))

  // Tomorrow's matches are gone, except the one somebody already joined.
  const later = catalog.filter((match) => match.match_day === tomorrow)
  assert.deepEqual(later.map((match) => match.match_id), [joinedTomorrow.id.toLowerCase()])
  assert.equal(later[0].day_no, 5)
})

test('admin matches take the next number of their day, and "#03" finds today\'s match 3', async () => {
  const created = await request('/api/admin/matches/create', { headers: admin, body: { mode: 'Lone Wolf 1v1', entryFee: 20, matchTimestamp: Date.UTC(2026, 10, 4, 15, 0) } })
  assert.equal(created.status, 201, JSON.stringify(created.data))
  assert.equal(created.data.match.match_day, today)
  assert.equal(created.data.match.day_no, 15)

  const updated = await request('/api/admin/matches/update', { method: 'PATCH', headers: admin, body: { matchId: '#03', roomId: 'ROOM3' } })
  assert.equal(updated.status, 200, JSON.stringify(updated.data))
  assert.equal(updated.data.match.match_day, today)
  assert.equal(updated.data.match.day_no, 3)
  assert.equal(updated.data.match.room_id, 'ROOM3')

  // Moving a match to tomorrow gives it tomorrow's next number.
  const moved = await request('/api/admin/matches/update', { method: 'PATCH', headers: admin, body: { matchId: created.data.match.match_id, matchTimestamp: Date.UTC(2026, 10, 5, 15, 0) } })
  assert.equal(moved.data.match.match_day, tomorrow)
  assert.equal(moved.data.match.day_no, 6)
})

test('the next day starts again from #01', async () => {
  const nextNoon = now + 24 * hour
  const scheduled = (await db.getPublicMatchCatalog(nextNoon))
    .filter((match) => match.match_day === tomorrow && !match.match_id.startsWith('admin-'))
    .sort((a, b) => a.match_timestamp - b.match_timestamp)
  assert.equal(scheduled.length, 14)
  // The match joined early keeps #05 and the admin match moved here keeps #06; the schedule fills
  // the free numbers from #01 in start order.
  assert.deepEqual(scheduled.map((match) => match.day_no), [1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15])
})
