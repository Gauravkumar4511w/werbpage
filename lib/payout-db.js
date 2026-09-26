/* global process, Buffer */

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

try { process.loadEnvFile?.() } catch {}

// Serverless deployments have a read-only project directory, so fall back to /tmp there.
const databaseDirectory = process.env.DATABASE_DIR || (process.env.VERCEL ? '/tmp/arenacore' : path.join(process.cwd(), 'data'))
fs.mkdirSync(databaseDirectory, { recursive: true })

const database = new DatabaseSync(path.join(databaseDirectory, 'arenacore.sqlite'))
database.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    user_key TEXT PRIMARY KEY,
    display_name TEXT NOT NULL DEFAULT '',
    credit_coins INTEGER NOT NULL DEFAULT 0,
    winning_coins INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS matches (
    match_id TEXT PRIMARY KEY,
    public_id TEXT UNIQUE,
    mode TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    entry_fee INTEGER NOT NULL CHECK (entry_fee > 0),
    match_timestamp INTEGER,
    prize_pool INTEGER,
    team_count INTEGER NOT NULL CHECK (team_count > 1),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'confirmed')),
    winner_team_key TEXT,
    confirmed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS match_entries (
    match_id TEXT NOT NULL REFERENCES matches(match_id),
    team_key TEXT NOT NULL,
    user_key TEXT NOT NULL,
    PRIMARY KEY (match_id, team_key, user_key)
  );

  CREATE TABLE IF NOT EXISTS payouts (
    match_id TEXT NOT NULL REFERENCES matches(match_id),
    user_key TEXT NOT NULL,
    amount INTEGER NOT NULL CHECK (amount > 0),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (match_id, user_key)
  );

  CREATE TABLE IF NOT EXISTS payment_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_key TEXT NOT NULL,
    amount INTEGER NOT NULL,
    coins INTEGER NOT NULL,
    utr TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS withdrawal_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_key TEXT NOT NULL,
    amount INTEGER NOT NULL,
    method TEXT NOT NULL,
    details TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS match_kills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id TEXT NOT NULL,
    user_key TEXT NOT NULL,
    kills INTEGER NOT NULL CHECK (kills >= 0),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (match_id, user_key)
  );

  CREATE TABLE IF NOT EXISTS deleted_matches (
    match_id TEXT PRIMARY KEY,
    public_id TEXT UNIQUE,
    deleted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS admins (
    email TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS admin_sessions (
    token TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`)

for (const statement of [
  "ALTER TABLE users ADD COLUMN display_name TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE users ADD COLUMN credit_coins INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE matches ADD COLUMN public_id TEXT",
  "ALTER TABLE matches ADD COLUMN mode TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE matches ADD COLUMN match_timestamp INTEGER",
  "ALTER TABLE matches ADD COLUMN prize_pool INTEGER",
  "ALTER TABLE matches ADD COLUMN description TEXT NOT NULL DEFAULT ''",
]) {
  try {
    database.exec(statement)
  } catch (error) {
    if (!String(error.message).includes('duplicate column name')) throw error
  }
}

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase()
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

function verifyPassword(password, storedHash) {
  const [salt, expected] = String(storedHash || '').split(':')
  if (!salt || !expected) return false
  const actual = crypto.scryptSync(password, salt, 64).toString('hex')
  return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'))
}

function ensureAdmin() {
  try { process.loadEnvFile?.() } catch {}
  const rawEmails = process.env.ADMIN_EMAIL || ''
  const password = process.env.ADMIN_PASSWORD
  if (!password) return false

  database.prepare(`
    CREATE TABLE IF NOT EXISTS admins (
      email TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL
    )
  `).run()

  const emails = new Set(
    rawEmails
      .split(/[,;]/)
      .map(normalizeKey)
      .filter(Boolean)
  )

  for (const email of Array.from(emails)) {
    if (email.includes('gaurau')) emails.add(email.replace('gaurau', 'gaurav'))
    if (email.includes('gaurav')) emails.add(email.replace('gaurav', 'gaurau'))
  }

  if (emails.size === 0) {
    emails.add('gaurav7744@gmail.com')
    emails.add('gaurau7744@gmail.com')
  }

  for (const email of emails) {
    const existing = database.prepare('SELECT email, password_hash FROM admins WHERE email = ?').get(email)
    if (!existing) {
      database.prepare('INSERT INTO admins (email, password_hash) VALUES (?, ?)').run(email, hashPassword(password))
    } else if (!verifyPassword(password, existing.password_hash)) {
      database.prepare('UPDATE admins SET password_hash = ? WHERE email = ?').run(hashPassword(password), email)
    }
  }
  return true
}

function authenticateAdmin(email, password) {
  if (!ensureAdmin()) return false
  if (!password) return false
  const inputEmail = normalizeKey(email)
  let admin = database.prepare('SELECT password_hash FROM admins WHERE email = ?').get(inputEmail)
  if (!admin) {
    if (inputEmail.includes('gaurau')) {
      admin = database.prepare('SELECT password_hash FROM admins WHERE email = ?').get(inputEmail.replace('gaurau', 'gaurav'))
    } else if (inputEmail.includes('gaurav')) {
      admin = database.prepare('SELECT password_hash FROM admins WHERE email = ?').get(inputEmail.replace('gaurav', 'gaurau'))
    } else if (inputEmail === 'admin' || inputEmail === 'admin@arenacore.com' || inputEmail === 'admin@gmail.com') {
      admin = database.prepare('SELECT password_hash FROM admins LIMIT 1').get()
    }
  }
  return Boolean(admin && verifyPassword(password, admin.password_hash))
}

function createAdminSession() {
  const token = crypto.randomBytes(32).toString('hex')
  const expiresInSeconds = 8 * 60 * 60
  const expiresAt = Date.now() + expiresInSeconds * 1000
  database.prepare('INSERT INTO admin_sessions (token, expires_at) VALUES (?, ?)').run(token, expiresAt)
  return { token, expiresIn: expiresInSeconds }
}

function verifyAdminSession(token) {
  if (!token) return false
  const session = database.prepare('SELECT token, expires_at FROM admin_sessions WHERE token = ?').get(token)
  if (!session) return false
  if (session.expires_at <= Date.now()) {
    database.prepare('DELETE FROM admin_sessions WHERE token = ?').run(token)
    return false
  }
  return true
}

function deleteAdminSession(token) {
  if (!token) return
  database.prepare('DELETE FROM admin_sessions WHERE token = ?').run(token)
}

function registerMatch({ matchId, entryFee, teams }) {
  const normalizedMatchId = normalizeKey(matchId)
  const fee = Number(entryFee)
  if (!normalizedMatchId || !Number.isInteger(fee) || fee <= 0 || !Array.isArray(teams) || teams.length < 2) {
    throw new Error('A match id, positive entry fee, and at least two teams are required.')
  }

  const normalizedTeams = teams.map((team, index) => {
    const teamKey = normalizeKey(team.teamKey || `team-${index + 1}`)
    const members = Array.isArray(team.userKeys) ? team.userKeys.map(normalizeKey).filter(Boolean) : []
    if (!members.length) throw new Error('Every team must have at least one user.')
    return { teamKey, members }
  })

  const insert = database.prepare('INSERT INTO matches (match_id, entry_fee, team_count) VALUES (?, ?, ?)')
  const insertEntry = database.prepare('INSERT INTO match_entries (match_id, team_key, user_key) VALUES (?, ?, ?)')
  database.exec('BEGIN IMMEDIATE')
  try {
    insert.run(normalizedMatchId, fee, normalizedTeams.length)
    for (const team of normalizedTeams) {
      for (const userKey of team.members) {
        insertEntry.run(normalizedMatchId, team.teamKey, userKey)
        database.prepare('INSERT INTO users (user_key) VALUES (?) ON CONFLICT(user_key) DO NOTHING').run(userKey)
      }
    }
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

function normalizePublicId(value) {
  return String(value || '').trim().replace(/^#/, '').padStart(6, '0')
}

function findMatch(matchIdOrPublicId) {
  const value = String(matchIdOrPublicId || '').trim()
  const publicId = normalizePublicId(value)
  return database.prepare('SELECT * FROM matches WHERE match_id = ? OR public_id = ?').get(value.toLowerCase(), publicId)
}

function updateMatchDetails({ matchId, publicId, entryFee, matchTimestamp, prizePool, description }) {
  const match = findMatch(matchId || publicId)
  if (!match) throw new Error('Match not found.')
  const nextFee = entryFee === '' || entryFee === undefined ? match.entry_fee : Number(entryFee)
  const nextTime = matchTimestamp === '' || matchTimestamp === undefined ? match.match_timestamp : Number(matchTimestamp)
  const nextPrize = prizePool === '' || prizePool === undefined ? match.prize_pool : Number(prizePool)
  if (!Number.isInteger(nextFee) || nextFee <= 0 || (nextTime !== null && !Number.isFinite(nextTime)) || (nextPrize !== null && (!Number.isInteger(nextPrize) || nextPrize < 0))) {
    throw new Error('Invalid match settings.')
  }
  const nextDescription = description === undefined ? match.description : String(description)
  database.prepare('UPDATE matches SET entry_fee = ?, match_timestamp = ?, prize_pool = ?, description = ? WHERE match_id = ?').run(nextFee, nextTime, nextPrize, nextDescription, match.match_id)
  return findMatch(match.match_id)
}

function createAdminMatch({ mode, entryFee, matchTimestamp, prizePool = null, description = '' }) {
  const normalizedMode = String(mode || '').trim()
  const fee = Number(entryFee)
  const timestamp = Number(matchTimestamp)
  const prize = prizePool === '' || prizePool === null || prizePool === undefined ? null : Number(prizePool)
  if (!normalizedMode || !Number.isInteger(fee) || fee <= 0 || !Number.isFinite(timestamp) || (prize !== null && (!Number.isInteger(prize) || prize < 0))) {
    throw new Error('Mode, entry fee, date/time, and a valid prize are required.')
  }
  const nextNumber = Number(database.prepare("SELECT COALESCE(MAX(CAST(public_id AS INTEGER)), 0) + 1 AS next_id FROM matches").get().next_id)
  const publicId = String(nextNumber).padStart(6, '0')
  const matchId = `admin-${publicId}-${Date.now()}`
  database.prepare('INSERT INTO matches (match_id, public_id, mode, description, entry_fee, match_timestamp, prize_pool, team_count) VALUES (?, ?, ?, ?, ?, ?, ?, 2)').run(matchId, publicId, normalizedMode, String(description), fee, timestamp, prize)
  return database.prepare('SELECT * FROM matches WHERE match_id = ?').get(matchId)
}

function deleteAdminMatch(matchIdOrPublicId) {
  const match = findMatch(matchIdOrPublicId)
  if (!match) throw new Error('Match not found.')
  if (match.status === 'confirmed') throw new Error('Confirmed matches cannot be deleted.')
  database.exec('BEGIN IMMEDIATE')
  try {
    database.prepare('DELETE FROM match_entries WHERE match_id = ?').run(match.match_id)
    database.prepare('DELETE FROM payouts WHERE match_id = ?').run(match.match_id)
    database.prepare('DELETE FROM match_kills WHERE match_id = ?').run(match.match_id)
    database.prepare('DELETE FROM matches WHERE match_id = ?').run(match.match_id)
    database.prepare('INSERT OR REPLACE INTO deleted_matches (match_id, public_id) VALUES (?, ?)').run(match.match_id, match.public_id)
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
  return { deleted: true, publicId: match.public_id }
}

function confirmMatchResult({ matchId, winnerTeamKey }) {
  const normalizedMatchId = normalizeKey(matchId)
  const normalizedWinner = normalizeKey(winnerTeamKey)
  const match = findMatch(normalizedMatchId)
  if (!match) throw new Error('Match is not registered.')
  if (match.status === 'confirmed') return getPayoutSummary(normalizedMatchId)

  const winningUsers = database.prepare(`
    SELECT user_key FROM match_entries WHERE match_id = ? AND team_key = ? ORDER BY user_key
  `).all(match.match_id, normalizedWinner)
  if (!winningUsers.length) throw new Error('Winning team is not registered for this match.')

  const totalPool = match.entry_fee * match.team_count
  const payoutPool = match.prize_pool === null || match.prize_pool === undefined
    ? Math.floor(totalPool * 0.8)
    : match.prize_pool
  const baseShare = Math.floor(payoutPool / winningUsers.length)
  const remainder = payoutPool % winningUsers.length

  database.exec('BEGIN IMMEDIATE')
  try {
    database.prepare(`UPDATE matches SET status = 'confirmed', winner_team_key = ?, confirmed_at = CURRENT_TIMESTAMP WHERE match_id = ?`)
      .run(normalizedWinner, match.match_id)
    const insertPayout = database.prepare('INSERT INTO payouts (match_id, user_key, amount) VALUES (?, ?, ?)')
    const addWinnings = database.prepare('UPDATE users SET winning_coins = winning_coins + ? WHERE user_key = ?')
    winningUsers.forEach((user, index) => {
      const amount = baseShare + (index < remainder ? 1 : 0)
      insertPayout.run(match.match_id, user.user_key, amount)
      addWinnings.run(amount, user.user_key)
    })
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
  return getPayoutSummary(normalizedMatchId)
}

function getAdminOverview() {
  registerDefaultCatalog()
  return {
    users: database.prepare(`SELECT user_key, display_name, credit_coins, winning_coins, created_at FROM users ORDER BY created_at DESC`).all(),
    matches: database.prepare(`SELECT match_id, public_id, mode, description, entry_fee, team_count, match_timestamp, prize_pool, status, winner_team_key, confirmed_at FROM matches ORDER BY match_id DESC`).all(),
    entries: database.prepare(`SELECT match_id, team_key, user_key FROM match_entries ORDER BY match_id DESC, team_key, user_key`).all(),
    payments: database.prepare(`SELECT id, user_key, amount, coins, utr, status, created_at FROM payment_requests ORDER BY id DESC`).all(),
    withdrawals: database.prepare(`SELECT id, user_key, amount, method, details, status, created_at FROM withdrawal_requests ORDER BY id DESC`).all(),
    kills: database.prepare(`SELECT id, match_id, user_key, kills, created_at FROM match_kills ORDER BY id DESC`).all(),
  }
}

function adjustCreditCoins({ userKey, amount, displayName = '' }) {
  const normalizedUser = normalizeKey(userKey)
  const coins = Number(amount)
  if (!normalizedUser || !Number.isInteger(coins) || coins === 0) throw new Error('User and a non-zero whole coin amount are required.')
  database.prepare(`
    INSERT INTO users (user_key, display_name, credit_coins) VALUES (?, ?, ?)
    ON CONFLICT(user_key) DO UPDATE SET credit_coins = credit_coins + excluded.credit_coins,
      display_name = CASE WHEN excluded.display_name <> '' THEN excluded.display_name ELSE users.display_name END
  `).run(normalizedUser, displayName, coins)
  return database.prepare('SELECT user_key, display_name, credit_coins, winning_coins FROM users WHERE user_key = ?').get(normalizedUser)
}

function recordPaymentRequest({ userKey, amount, coins, utr = '' }) {
  const normalizedUser = normalizeKey(userKey)
  if (!normalizedUser || !Number.isInteger(Number(amount)) || !Number.isInteger(Number(coins))) throw new Error('Invalid payment request.')
  database.prepare('INSERT INTO users (user_key) VALUES (?) ON CONFLICT(user_key) DO NOTHING').run(normalizedUser)
  database.prepare('INSERT INTO payment_requests (user_key, amount, coins, utr) VALUES (?, ?, ?, ?)').run(normalizedUser, Number(amount), Number(coins), String(utr))
}

function recordMatchEntry({ matchId, publicId, mode, matchTimestamp, entryFee, teamKey, userKey }) {
  const normalizedMatch = normalizeKey(matchId)
  const normalizedTeam = normalizeKey(teamKey)
  const normalizedUser = normalizeKey(userKey)
  const fee = Number(entryFee)
  if (!normalizedMatch || !normalizedTeam || !normalizedUser || !Number.isInteger(fee) || fee <= 0) throw new Error('Invalid match entry.')
  const normalizedPublicId = normalizePublicId(publicId)
  const normalizedMode = String(mode || '')
  const timestamp = matchTimestamp === undefined ? null : Number(matchTimestamp)
  database.prepare("INSERT INTO matches (match_id, public_id, mode, entry_fee, match_timestamp, team_count) VALUES (?, ?, ?, ?, ?, 2) ON CONFLICT(match_id) DO UPDATE SET public_id = COALESCE(excluded.public_id, matches.public_id), mode = COALESCE(NULLIF(excluded.mode, ''), matches.mode), match_timestamp = COALESCE(excluded.match_timestamp, matches.match_timestamp)").run(normalizedMatch, normalizedPublicId || null, normalizedMode, fee, timestamp)
  database.prepare('INSERT INTO users (user_key) VALUES (?) ON CONFLICT(user_key) DO NOTHING').run(normalizedUser)
  database.prepare('INSERT INTO match_entries (match_id, team_key, user_key) VALUES (?, ?, ?) ON CONFLICT(match_id, team_key, user_key) DO NOTHING').run(normalizedMatch, normalizedTeam, normalizedUser)
}

function registerMatchCatalog(matches) {
  if (!Array.isArray(matches)) throw new Error('Match catalog must be an array.')
  const statement = database.prepare(`
    INSERT OR IGNORE INTO matches (match_id, public_id, mode, entry_fee, match_timestamp, team_count)
    SELECT ?, ?, ?, ?, ?, 2
    WHERE NOT EXISTS (SELECT 1 FROM deleted_matches WHERE match_id = ? OR public_id = ?)
  `)
  for (const match of matches) {
    const fee = Number(match.entryFee)
    if (!match.id || !match.publicId || !Number.isInteger(fee) || fee <= 0) continue
    const matchId = normalizeKey(match.id)
    const publicId = normalizePublicId(match.publicId)
    statement.run(matchId, publicId, String(match.mode || ''), fee, Number(match.matchTimestamp) || null, matchId, publicId)
  }
}

function getPublicMatchCatalog() {
  registerDefaultCatalog()
  return database.prepare('SELECT match_id, public_id, mode, description, entry_fee, match_timestamp, prize_pool FROM matches ORDER BY match_id').all()
}

function registerDefaultCatalog() {
  const existingCount = Number(database.prepare('SELECT COUNT(*) AS count FROM matches').get()?.count || 0)
  if (existingCount > 0) return
  const modes = [
    ['Battle Royale Solo', 50], ['Battle Royale Duo', 100], ['Battle Royale Squad', 150],
    ['Clash Squad 1v1', 50], ['Clash Squad 2v2', 100], ['Clash Squad 4v4', 200], ['Lone Wolf 1v1', 75],
  ]
  const matches = []
  const today = new Date()
  for (let dayIndex = 0; dayIndex < 5; dayIndex += 1) {
    const date = new Date(today)
    date.setHours(0, 0, 0, 0)
    date.setDate(today.getDate() + dayIndex)
    for (let round = 0; round < 2; round += 1) {
      modes.forEach(([mode, entryFee], modeIndex) => {
        const minutes = 8 * 60 + (round * modes.length + modeIndex) * 80
        const matchDate = new Date(date)
        matchDate.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0)
        const matchNumber = dayIndex * 2 * modes.length + round * modes.length + modeIndex + 1
        matches.push({ id: `${date.toISOString()}-${minutes}-${mode}`, publicId: `#${String(matchNumber).padStart(6, '0')}`, mode, entryFee, matchTimestamp: matchDate.getTime() })
      })
    }
  }
  registerMatchCatalog(matches)
}

function recordWithdrawalRequest({ userKey, amount, method, details = {} }) {
  const normalizedUser = normalizeKey(userKey)
  if (!normalizedUser || !Number.isInteger(Number(amount)) || !method) throw new Error('Invalid withdrawal request.')
  database.prepare('INSERT INTO withdrawal_requests (user_key, amount, method, details) VALUES (?, ?, ?, ?)').run(normalizedUser, Number(amount), String(method), JSON.stringify(details))
}

function recordMatchKills({ matchId, kills }) {
  const normalizedMatch = normalizeKey(matchId)
  if (!normalizedMatch || !Array.isArray(kills)) throw new Error('Match and kills are required.')
  const statement = database.prepare(`
    INSERT INTO match_kills (match_id, user_key, kills) VALUES (?, ?, ?)
    ON CONFLICT(match_id, user_key) DO UPDATE SET kills = excluded.kills
  `)
  for (const entry of kills) {
    const userKey = normalizeKey(entry.userKey)
    const count = Number(entry.kills)
    if (!userKey || !Number.isInteger(count) || count < 0) throw new Error('Invalid kill record.')
    statement.run(normalizedMatch, userKey, count)
  }
}

function getPayoutSummary(matchId) {
  const match = findMatch(matchId)
  const payouts = database.prepare('SELECT user_key, amount FROM payouts WHERE match_id = ? ORDER BY user_key').all(match.match_id)
  return {
    matchId,
    status: match.status,
    entryFee: match.entry_fee,
    totalPool: match.entry_fee * match.team_count,
    payoutPool: payouts.reduce((total, payout) => total + payout.amount, 0),
    platformMargin: (match.entry_fee * match.team_count) - payouts.reduce((total, payout) => total + payout.amount, 0),
    winnerTeamKey: match.winner_team_key,
    payouts,
  }
}

export {
  adjustCreditCoins,
  authenticateAdmin,
  confirmMatchResult,
  createAdminMatch,
  createAdminSession,
  deleteAdminMatch,
  deleteAdminSession,
  getAdminOverview,
  getPublicMatchCatalog,
  recordMatchEntry,
  recordMatchKills,
  recordPaymentRequest,
  recordWithdrawalRequest,
  registerMatch,
  registerMatchCatalog,
  registerDefaultCatalog,
  updateMatchDetails,
  verifyAdminSession,
}
