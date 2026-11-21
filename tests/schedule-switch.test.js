/* global process */
import './isolate-env.js'
import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createClient } from '@libsql/client'

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'arenacore-switch-test-'))
process.env.DATABASE_DIR = directory
const db = await import('../lib/payout-db.js')
after(() => fs.rmSync(directory, { recursive: true, force: true }))

const minute = 60 * 1000
const midnight = Date.UTC(2026, 10, 20, 18, 30) // 00:00 on 21 November in India
const modes = ['Battle Royale Solo', 'Battle Royale Duo', 'Battle Royale Squad', 'Clash Squad 1v1', 'Clash Squad 2v2', 'Clash Squad 4v4', 'Lone Wolf 1v1']
const fees = { 'Battle Royale Solo': 10, 'Battle Royale Duo': 25, 'Battle Royale Squad': 15, 'Clash Squad 1v1': 10, 'Clash Squad 2v2': 15, 'Clash Squad 4v4': 15, 'Lone Wolf 1v1': 10 }
const indiaTime = (timestamp) => new Date(Number(timestamp) + 330 * minute).toISOString().slice(11, 16)

// 21 Nov's matches as they were made at midnight, on the old timetable: 8:00 AM, then every
// 80 minutes until 1:20 AM, numbered #01 to #14.
const oldDay = [0, 1].flatMap((round) => modes.map((mode, index) => {
  const minutes = 8 * 60 + (round * modes.length + index) * 80
  return { id: `${new Date(midnight).toISOString()}-${minutes}-${mode}`.toLowerCase(), mode, round, timestamp: midnight + minutes * minute }
}))
// Someone already joined the 5:20 PM Solo match.
const joinedOld = oldDay.find((match) => indiaTime(match.timestamp) === '17:20')

test('switching today keeps started and joined matches and adds the new times still to come', async () => {
  await db.getPublicMatchCatalog(Date.UTC(2026, 9, 1)) // sets up the database
  const raw = createClient({ url: `file:${path.join(directory, 'arenacore.sqlite')}` })
  for (const [index, match] of oldDay.entries()) {
    await raw.execute({
      sql: 'INSERT INTO matches (match_id, public_id, mode, entry_fee, free_entry, match_timestamp, team_count, match_day, day_no) VALUES (?, ?, ?, ?, ?, ?, 2, ?, ?)',
      args: [match.id, `9${String(index).padStart(5, '0')}`, match.mode, fees[match.mode], match.round === 0 && match.mode.startsWith('Battle Royale') ? 1 : 0, match.timestamp, '2026-11-21', index + 1],
    })
  }
  await raw.execute({ sql: "INSERT INTO match_entries (match_id, team_key, user_key, identifiers, team_no) VALUES (?, 'early@test.com', 'early@test.com', '[]', 1)", args: [joinedOld.id] })
  raw.close()

  const now = midnight + (12 * 60 + 42) * minute // 12:42 PM, when the switch went live
  const today = (await db.getPublicMatchCatalog(now)).filter((match) => match.match_day === '2026-11-21')
  const list = today.map((match) => `${indiaTime(match.match_timestamp)} ${match.mode}${match.free_entry ? ' FREE' : ''}`)
  assert.deepEqual(list, [
    // Already started on the old timetable: kept.
    '08:00 Battle Royale Solo FREE',
    '09:20 Battle Royale Duo FREE',
    '10:40 Battle Royale Squad FREE',
    '12:00 Clash Squad 1v1',
    // The new hourly times still to come.
    '13:00 Lone Wolf 1v1',
    '14:00 Lone Wolf 1v1',
    '15:00 Clash Squad 2v2',
    '16:00 Clash Squad 2v2',
    '17:00 Battle Royale Duo FREE',
    // Joined before the switch: kept at its time.
    '17:20 Battle Royale Solo',
    '18:00 Battle Royale Duo',
    '19:00 Battle Royale Squad FREE',
    '20:00 Battle Royale Squad',
    '21:00 Clash Squad 4v4',
    '22:00 Clash Squad 4v4',
  ])
  // Every match keeps a number of its own; the kept ones keep theirs.
  assert.equal(new Set(today.map((match) => match.day_no)).size, today.length)
  assert.equal(today.find((match) => match.match_id === joinedOld.id).day_no, 8)

  // Loading again changes nothing.
  const again = (await db.getPublicMatchCatalog(now + 5 * minute)).filter((match) => match.match_day === '2026-11-21')
  assert.deepEqual(again.map((match) => match.match_id), today.map((match) => match.match_id))
})
