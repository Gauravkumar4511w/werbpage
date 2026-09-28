/* global process, Buffer */

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { signAdminSession, verifySignedAdminSession } from './admin-session.js'
import { EDIT_LOCK_MS, ROOM_REVEAL_MS, getMatchCapacity, getScheduledMatches, getTeamSize } from './match-schedule.js'

try { process.loadEnvFile?.() } catch { /* Deployed environments may not have a local .env file. */ }

// Serverless deployments have a read-only project directory, so fall back to /tmp there.
let databaseDirectory = process.env.DATABASE_DIR
if (!databaseDirectory || process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
  databaseDirectory = (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) ? '/tmp/arenacore' : path.join(process.cwd(), 'data')
}

try {
  fs.mkdirSync(databaseDirectory, { recursive: true })
} catch {
  databaseDirectory = '/tmp/arenacore'
  fs.mkdirSync(databaseDirectory, { recursive: true })
}

let database
try {
  database = new DatabaseSync(path.join(databaseDirectory, 'arenacore.sqlite'))
} catch {
  databaseDirectory = '/tmp/arenacore'
  fs.mkdirSync(databaseDirectory, { recursive: true })
  database = new DatabaseSync(path.join(databaseDirectory, 'arenacore.sqlite'))
}
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

  CREATE TABLE IF NOT EXISTS active_sessions (
    session_id TEXT PRIMARY KEY,
    user_key TEXT NOT NULL DEFAULT '',
    ip TEXT NOT NULL DEFAULT '',
    last_seen INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS wallet_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_key TEXT NOT NULL,
    wallet TEXT NOT NULL CHECK (wallet IN ('credit', 'winning')),
    amount INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,
    reason TEXT NOT NULL,
    reference TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS wallet_transactions_user ON wallet_transactions (user_key, id);

  CREATE TABLE IF NOT EXISTS admin_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    user_key TEXT NOT NULL DEFAULT '',
    reference_id INTEGER,
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    read_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`)

for (const statement of [
  "ALTER TABLE users ADD COLUMN display_name TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE users ADD COLUMN credit_coins INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE users ADD COLUMN phone TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE users ADD COLUMN email TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE users ADD COLUMN password TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'",
  "ALTER TABLE users ADD COLUMN last_active_at INTEGER DEFAULT 0",
  "ALTER TABLE matches ADD COLUMN public_id TEXT",
  "ALTER TABLE matches ADD COLUMN mode TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE matches ADD COLUMN match_timestamp INTEGER",
  "ALTER TABLE matches ADD COLUMN prize_pool INTEGER",
  "ALTER TABLE matches ADD COLUMN description TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE payment_requests ADD COLUMN reviewed_at TEXT",
  "ALTER TABLE payment_requests ADD COLUMN review_note TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE withdrawal_requests ADD COLUMN reviewed_at TEXT",
  "ALTER TABLE withdrawal_requests ADD COLUMN review_note TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE match_entries ADD COLUMN identifiers TEXT NOT NULL DEFAULT '[]'",
  "ALTER TABLE matches ADD COLUMN room_id TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE matches ADD COLUMN room_password TEXT NOT NULL DEFAULT ''",
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

function httpError(status, message) {
  return Object.assign(new Error(message), { status })
}

function transaction(work) {
  database.exec('BEGIN IMMEDIATE')
  try {
    const result = work()
    database.exec('COMMIT')
    return result
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

const userColumns = 'user_key, display_name, email, phone, credit_coins, winning_coins, status, last_active_at, created_at'
const walletColumns = { credit: 'credit_coins', winning: 'winning_coins' }

function getUserRow(userKey) {
  return database.prepare(`SELECT ${userColumns} FROM users WHERE user_key = ?`).get(userKey)
}

// Every balance change goes through here so the ledger always explains the balance.
// Call it inside transaction(); it throws rather than let a balance go below zero.
function applyWalletChange({ userKey, wallet, amount, reason, reference = '', note = '' }) {
  const column = walletColumns[wallet]
  if (!column) throw new Error('Wallet must be "credit" or "winning".')
  database.prepare("INSERT INTO users (user_key, status) VALUES (?, 'active') ON CONFLICT(user_key) DO NOTHING").run(userKey)
  const current = Number(database.prepare(`SELECT ${column} AS balance FROM users WHERE user_key = ?`).get(userKey).balance)
  const next = current + amount
  if (next < 0) throw new Error(`Not enough ${wallet} coins. Current ${wallet} balance is ${current}.`)
  database.prepare(`UPDATE users SET ${column} = ? WHERE user_key = ?`).run(next, userKey)
  database.prepare('INSERT INTO wallet_transactions (user_key, wallet, amount, balance_after, reason, reference, note) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(userKey, wallet, amount, next, reason, String(reference), String(note))
  return next
}

function addAdminNotification({ type, userKey = '', referenceId = null, title, body = '' }) {
  database.prepare('INSERT INTO admin_notifications (type, user_key, reference_id, title, body) VALUES (?, ?, ?, ?, ?)')
    .run(type, userKey, referenceId, title, body)
}

function markReferenceNotificationsRead(type, referenceId) {
  database.prepare('UPDATE admin_notifications SET read_at = CURRENT_TIMESTAMP WHERE type = ? AND reference_id = ? AND read_at IS NULL').run(type, referenceId)
}

// Players sign up in the browser, which syncs their password to the users table. Accounts
// that have a stored password must present it before reading or spending their wallet.
function passwordMatches(given, stored) {
  const givenBuffer = Buffer.from(String(given || ''))
  const storedBuffer = Buffer.from(String(stored || ''))
  return givenBuffer.length === storedBuffer.length && crypto.timingSafeEqual(givenBuffer, storedBuffer)
}

function authorizeUser(userKey, password) {
  const normalizedUser = normalizeKey(userKey)
  if (!normalizedUser) throw new Error('User key is required.')
  const stored = database.prepare('SELECT password FROM users WHERE user_key = ?').get(normalizedUser)?.password
  if (stored && !passwordMatches(password, stored)) {
    throw httpError(403, 'Could not verify this account. Please log in again.')
  }
  return normalizedUser
}

// Phone numbers are typed many ways ("+91 98765 43210", "9876543210"); compare the last ten digits.
function phoneTail(value) {
  const digits = String(value || '').replace(/\D/g, '')
  return digits.length >= 10 ? digits.slice(-10) : ''
}

// Accounts were only kept in the browser that created them, so logging in on a phone failed.
// This lets any device log in with the email or mobile number and password stored on the server.
function loginUser({ login, password }) {
  const value = normalizeKey(login)
  if (!value || !password) throw httpError(400, 'Enter your email or mobile number and password.')
  const tail = phoneTail(value)
  const candidates = database.prepare(`
    SELECT user_key, display_name, email, phone, password FROM users
    WHERE password <> '' AND (
      user_key = ? OR lower(email) = ?
      OR (? <> '' AND (replace(replace(phone, ' ', ''), '-', '') LIKE '%' || ? OR replace(replace(user_key, ' ', ''), '-', '') LIKE '%' || ?))
    )
    ORDER BY last_active_at DESC
  `).all(value, value, tail, tail, tail)
    .filter((user) => user.user_key === value || user.email === value || (tail && (phoneTail(user.phone) === tail || phoneTail(user.user_key) === tail)))
  const user = candidates.find((candidate) => passwordMatches(password, candidate.password))
  if (!user) throw httpError(401, 'No account found with these credentials. Check your details or sign up.')
  return { userKey: user.user_key, name: user.display_name || user.user_key, email: user.email, phone: user.phone }
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
  try { process.loadEnvFile?.() } catch { /* Deployed environments may not have a local .env file. */ }
  const rawEmails = process.env.ADMIN_EMAIL || ''
  // Admin login stays disabled until ADMIN_PASSWORD is set, so there is no default password.
  const password = process.env.ADMIN_PASSWORD || ''
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
  const expiresInSeconds = 8 * 60 * 60
  const expiresAt = Date.now() + expiresInSeconds * 1000
  const secret = process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_PASSWORD
  if (secret) {
    return { token: signAdminSession(secret, expiresAt), expiresIn: expiresInSeconds }
  }
  const token = crypto.randomBytes(32).toString('hex')
  database.prepare('INSERT INTO admin_sessions (token, expires_at) VALUES (?, ?)').run(token, expiresAt)
  return { token, expiresIn: expiresInSeconds }
}

function verifyAdminSession(token) {
  if (!token) return false
  if (token.startsWith('v1.')) {
    return verifySignedAdminSession(token, process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_PASSWORD)
  }
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

function updateMatchDetails({ matchId, publicId, entryFee, matchTimestamp, prizePool, description, roomId, roomPassword }) {
  const match = findMatch(matchId || publicId)
  if (!match) throw new Error('Match not found.')
  const nextFee = entryFee === '' || entryFee === undefined ? match.entry_fee : Number(entryFee)
  const nextTime = matchTimestamp === '' || matchTimestamp === undefined ? match.match_timestamp : Number(matchTimestamp)
  const nextPrize = prizePool === '' || prizePool === undefined ? match.prize_pool : Number(prizePool)
  if (!Number.isInteger(nextFee) || nextFee <= 0 || (nextTime !== null && !Number.isFinite(nextTime)) || (nextPrize !== null && (!Number.isInteger(nextPrize) || nextPrize < 0))) {
    throw new Error('Invalid match settings.')
  }
  const nextDescription = description === undefined ? match.description : String(description)
  const nextRoomId = roomId === undefined ? match.room_id : String(roomId).trim().slice(0, 40)
  const nextRoomPassword = roomPassword === undefined ? match.room_password : String(roomPassword).trim().slice(0, 40)
  database.prepare('UPDATE matches SET entry_fee = ?, match_timestamp = ?, prize_pool = ?, description = ?, room_id = ?, room_password = ? WHERE match_id = ?')
    .run(nextFee, nextTime, nextPrize, nextDescription, nextRoomId, nextRoomPassword, match.match_id)
  return findMatch(match.match_id)
}

// Public ids come only from the server. Browsers used to number matches from "today", so the same
// number meant a different match every day and joining failed on the unique public_id.
function nextPublicId() {
  const last = database.prepare('SELECT MAX(CAST(public_id AS INTEGER)) AS last FROM (SELECT public_id FROM matches UNION ALL SELECT public_id FROM deleted_matches)').get().last
  return String(Number(last || 0) + 1).padStart(6, '0')
}

// Adds any daily matches for the next few days that are not stored yet. Deleted matches stay deleted.
function ensureScheduledMatches(now = Date.now()) {
  const known = database.prepare('SELECT 1 FROM matches WHERE match_id = ? UNION ALL SELECT 1 FROM deleted_matches WHERE match_id = ?')
  const isMissing = (match) => !known.get(normalizeKey(match.id), normalizeKey(match.id))
  if (!getScheduledMatches(now).some(isMissing)) return
  transaction(() => {
    const insert = database.prepare('INSERT INTO matches (match_id, public_id, mode, entry_fee, match_timestamp, team_count) VALUES (?, ?, ?, ?, ?, 2)')
    for (const match of getScheduledMatches(now).filter(isMissing)) {
      insert.run(normalizeKey(match.id), nextPublicId(), match.mode, match.entryFee, match.matchTimestamp)
    }
  })
}

function createAdminMatch({ mode, entryFee, matchTimestamp, prizePool = null, description = '' }) {
  const normalizedMode = String(mode || '').trim()
  const fee = Number(entryFee)
  const timestamp = Number(matchTimestamp)
  const prize = prizePool === '' || prizePool === null || prizePool === undefined ? null : Number(prizePool)
  if (!normalizedMode || !Number.isInteger(fee) || fee <= 0 || !Number.isFinite(timestamp) || (prize !== null && (!Number.isInteger(prize) || prize < 0))) {
    throw new Error('Mode, entry fee, date/time, and a valid prize are required.')
  }
  const publicId = nextPublicId()
  const matchId = `admin-${publicId}-${Date.now()}`
  database.prepare('INSERT INTO matches (match_id, public_id, mode, description, entry_fee, match_timestamp, prize_pool, team_count) VALUES (?, ?, ?, ?, ?, ?, ?, 2)').run(matchId, publicId, normalizedMode, String(description), fee, timestamp, prize)
  return database.prepare('SELECT * FROM matches WHERE match_id = ?').get(matchId)
}

function deleteAdminMatch(matchIdOrPublicId) {
  const match = findMatch(matchIdOrPublicId)
  if (!match) throw new Error('Match not found.')
  if (match.status === 'confirmed') throw new Error('Confirmed matches cannot be deleted.')
  const refunds = transaction(() => {
    // Give back every entry fee that was charged for this match.
    const paid = database.prepare(`
      SELECT user_key, wallet, -SUM(amount) AS paid FROM wallet_transactions
      WHERE reference = ? AND reason IN ('match_entry', 'match_refund')
      GROUP BY user_key, wallet HAVING paid > 0
    `).all(match.match_id)
    for (const row of paid) {
      applyWalletChange({ userKey: row.user_key, wallet: row.wallet, amount: row.paid, reason: 'match_refund', reference: match.match_id, note: `Match #${match.public_id || match.match_id} deleted` })
    }
    database.prepare('DELETE FROM match_entries WHERE match_id = ?').run(match.match_id)
    database.prepare('DELETE FROM payouts WHERE match_id = ?').run(match.match_id)
    database.prepare('DELETE FROM match_kills WHERE match_id = ?').run(match.match_id)
    database.prepare('DELETE FROM matches WHERE match_id = ?').run(match.match_id)
    database.prepare('INSERT OR REPLACE INTO deleted_matches (match_id, public_id) VALUES (?, ?)').run(match.match_id, match.public_id)
    return paid.length
  })
  return { deleted: true, publicId: match.public_id, refunds }
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

  const totalPool = match.entry_fee * countJoinedTeams(match)
  const payoutPool = match.prize_pool === null || match.prize_pool === undefined
    ? Math.floor(totalPool * 0.8)
    : match.prize_pool
  const baseShare = Math.floor(payoutPool / winningUsers.length)
  const remainder = payoutPool % winningUsers.length

  transaction(() => {
    database.prepare(`UPDATE matches SET status = 'confirmed', winner_team_key = ?, confirmed_at = CURRENT_TIMESTAMP WHERE match_id = ?`)
      .run(normalizedWinner, match.match_id)
    const insertPayout = database.prepare('INSERT INTO payouts (match_id, user_key, amount) VALUES (?, ?, ?)')
    winningUsers.forEach((user, index) => {
      const amount = baseShare + (index < remainder ? 1 : 0)
      if (amount <= 0) return
      insertPayout.run(match.match_id, user.user_key, amount)
      applyWalletChange({ userKey: user.user_key, wallet: 'winning', amount, reason: 'match_win', reference: match.match_id, note: `Won match #${match.public_id || match.match_id}` })
    })
  })
  return getPayoutSummary(normalizedMatchId)
}

function recordUserPresence({ sessionId, userKey = '', ip = '' }) {
  const now = Date.now()
  const cutoff = now - 60000
  const normalizedSession = String(sessionId || '').trim() || crypto.randomUUID()
  const normalizedUser = normalizeKey(userKey)

  database.prepare('DELETE FROM active_sessions WHERE last_seen < ?').run(cutoff)

  database.prepare(`
    INSERT INTO active_sessions (session_id, user_key, ip, last_seen)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET
      user_key = CASE WHEN excluded.user_key <> '' THEN excluded.user_key ELSE active_sessions.user_key END,
      ip = CASE WHEN excluded.ip <> '' THEN excluded.ip ELSE active_sessions.ip END,
      last_seen = excluded.last_seen
  `).run(normalizedSession, normalizedUser, String(ip || ''), now)

  if (normalizedUser) {
    database.prepare(`
      INSERT INTO users (user_key, last_active_at, status)
      VALUES (?, ?, 'active')
      ON CONFLICT(user_key) DO UPDATE SET
        last_active_at = excluded.last_active_at,
        status = CASE WHEN users.status = 'inactive' THEN 'inactive' ELSE 'active' END
    `).run(normalizedUser, now)
  }

  return getLiveStats()
}

function getLiveStats() {
  const now = Date.now()
  const cutoff = now - 60000
  database.prepare('DELETE FROM active_sessions WHERE last_seen < ?').run(cutoff)

  const activeSessions = database.prepare('SELECT session_id, user_key FROM active_sessions WHERE last_seen >= ?').all(cutoff)
  const totalUsersRow = database.prepare('SELECT COUNT(*) as count FROM users').get()
  const activeUsersRow = database.prepare("SELECT COUNT(*) as count FROM users WHERE status != 'inactive'").get()

  const onlineSessionsCount = activeSessions.length
  const onlineUserKeys = new Set(activeSessions.map((s) => s.user_key).filter(Boolean))
  const onlineUsersCount = onlineUserKeys.size
  const totalUsers = totalUsersRow?.count || 0
  const activeUsers = activeUsersRow?.count || 0

  // Live player count: reflects active users online, at minimum 1 when any visitor is connected
  const liveCount = Math.max(onlineSessionsCount, activeUsers, 1)

  return {
    liveCount,
    onlineSessionsCount,
    onlineUsersCount,
    activeUsersCount: activeUsers,
    totalUsers,
  }
}

// Balances are never set here: browsers re-sync their users on every visit, so accepting a
// coin value would re-credit it each time. Coins only move through applyWalletChange().
// Players (trusted = false) must give the stored password to change an existing account, and
// cannot change its status, so re-registering never takes over a number or undoes a deactivation.
function registerOrUpdateUser({ userKey, displayName = '', email = '', phone = '', password = '', status = 'active' }, { trusted = false } = {}) {
  const normalizedUser = normalizeKey(userKey || email || phone)
  if (!normalizedUser) throw new Error('User email, phone, or username is required.')
  const now = Date.now()
  const cleanName = String(displayName || '').trim()
  const cleanEmail = String(email || '').trim().toLowerCase()
  const cleanPhone = String(phone || '').trim()
  const cleanPassword = String(password || '').trim()
  const cleanStatus = status === 'inactive' ? 'inactive' : 'active'

  const existing = database.prepare('SELECT password FROM users WHERE user_key = ?').get(normalizedUser)
  if (!trusted && existing?.password && !passwordMatches(cleanPassword, existing.password)) {
    throw httpError(409, 'An account already exists with this email or mobile number. Please log in.')
  }
  if (!trusted && !existing && findContactConflict({ userKey: normalizedUser, email: cleanEmail, phone: cleanPhone })) {
    throw httpError(409, 'An account already exists with this email or mobile number. Please log in.')
  }

  database.prepare(`
    INSERT INTO users (user_key, display_name, email, phone, password, status, last_active_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_key) DO UPDATE SET
      display_name = CASE WHEN excluded.display_name <> '' THEN excluded.display_name ELSE users.display_name END,
      email = CASE WHEN excluded.email <> '' THEN excluded.email ELSE users.email END,
      phone = CASE WHEN excluded.phone <> '' THEN excluded.phone ELSE users.phone END,
      password = CASE WHEN excluded.password <> '' THEN excluded.password ELSE users.password END,
      status = CASE WHEN ? THEN excluded.status ELSE users.status END,
      last_active_at = excluded.last_active_at
  `).run(normalizedUser, cleanName, cleanEmail, cleanPhone, cleanPassword, cleanStatus, now, trusted ? 1 : 0)

  return getUserRow(normalizedUser)
}

// Returns what another account already uses: its email, mobile number or gamer tag.
function findContactConflict({ userKey, email = '', phone = '', displayName = '' }) {
  const cleanEmail = normalizeKey(email)
  if (cleanEmail && database.prepare('SELECT 1 FROM users WHERE user_key <> ? AND (lower(email) = ? OR user_key = ?)').get(userKey, cleanEmail, cleanEmail)) {
    return 'That email is already used by another account.'
  }
  const tail = phoneTail(phone)
  if (tail) {
    const others = database.prepare(`
      SELECT phone, user_key FROM users WHERE user_key <> ?
        AND (replace(replace(phone, ' ', ''), '-', '') LIKE '%' || ? OR replace(replace(user_key, ' ', ''), '-', '') LIKE '%' || ?)
    `).all(userKey, tail, tail)
    if (others.some((user) => phoneTail(user.phone) === tail || phoneTail(user.user_key) === tail)) return 'That mobile number is already used by another account.'
  }
  const cleanName = normalizeKey(displayName)
  if (cleanName && database.prepare('SELECT 1 FROM users WHERE user_key <> ? AND lower(display_name) = ?').get(userKey, cleanName)) {
    return 'That gamer tag is taken. Try another one.'
  }
  return ''
}

// Players edit their gamer tag, email and mobile number here. The user key never changes, so the
// wallet and match entries stay with the account; login works with the new email or number.
function updateUserProfile({ userKey, password, displayName, email = '', phone = '' }) {
  const normalizedUser = authorizeUser(userKey, password)
  if (!getUserRow(normalizedUser)) throw httpError(404, 'Account not found. Please log in again.')
  const cleanName = String(displayName || '').trim()
  const cleanEmail = String(email || '').trim().toLowerCase()
  const cleanPhone = String(phone || '').trim()
  if (cleanName.length < 3 || cleanName.length > 24) throw new Error('Choose a gamer tag with 3 to 24 characters.')
  if (cleanEmail && !/^\S+@\S+\.\S+$/.test(cleanEmail)) throw new Error('Enter a valid email address.')
  if (cleanPhone && !/^\+?[0-9\s-]{10,15}$/.test(cleanPhone)) throw new Error('Enter a valid mobile number.')
  if (!cleanEmail && !cleanPhone) throw new Error('Keep an email or a mobile number so you can log in.')
  const conflict = findContactConflict({ userKey: normalizedUser, email: cleanEmail, phone: cleanPhone, displayName: cleanName })
  if (conflict) throw httpError(409, conflict)
  database.prepare('UPDATE users SET display_name = ?, email = ?, phone = ?, last_active_at = ? WHERE user_key = ?')
    .run(cleanName, cleanEmail, cleanPhone, Date.now(), normalizedUser)
  const user = getUserRow(normalizedUser)
  return { userKey: user.user_key, name: user.display_name, email: user.email, phone: user.phone }
}

function syncUsers(usersList) {
  if (!Array.isArray(usersList)) return []
  const results = []
  for (const user of usersList) {
    if (!user) continue
    const userKey = user.userKey || user.email || user.phone || user.name
    if (!userKey) continue
    // Existing accounts are left alone: a browser's copy may be older than a profile edit made elsewhere.
    if (database.prepare("SELECT 1 FROM users WHERE user_key = ? AND password <> ''").get(normalizeKey(userKey))) continue
    try {
      results.push(registerOrUpdateUser({
        userKey,
        displayName: user.name || user.displayName || '',
        email: user.email || '',
        phone: user.phone || '',
        password: user.password || '',
      }))
    } catch {
      // A stale copy of an account in one browser must not stop the others from syncing.
    }
  }
  return results
}

function adminSetUserStatus({ userKey, status }) {
  const normalizedUser = normalizeKey(userKey)
  if (!normalizedUser) throw new Error('User key is required.')
  const cleanStatus = status === 'inactive' ? 'inactive' : 'active'
  const { changes } = database.prepare('UPDATE users SET status = ? WHERE user_key = ?').run(cleanStatus, normalizedUser)
  if (!changes) throw httpError(404, 'User not found.')
  return getUserRow(normalizedUser)
}

function getAdminOverview() {
  ensureScheduledMatches()
  const now = Date.now()
  const cutoff = now - 60000

  // Purge expired sessions
  database.prepare('DELETE FROM active_sessions WHERE last_seen < ?').run(cutoff)
  const activeSessions = database.prepare('SELECT DISTINCT user_key FROM active_sessions WHERE last_seen >= ?').all(cutoff)
  const onlineUserSet = new Set(activeSessions.map((s) => s.user_key).filter(Boolean))

  const users = database.prepare(`SELECT ${userColumns} FROM users ORDER BY created_at DESC`).all().map((u) => ({
    ...u,
    status: u.status || 'active',
    is_online: onlineUserSet.has(u.user_key) || (u.last_active_at && (now - Number(u.last_active_at) < 60000)) ? 1 : 0,
  }))

  const stats = getLiveStats()

  return {
    users,
    activeUsersCount: stats.activeUsersCount,
    onlineUsersCount: stats.onlineUsersCount,
    liveCount: stats.liveCount,
    matches: database.prepare(`SELECT match_id, public_id, mode, description, entry_fee, team_count, match_timestamp, prize_pool, status, winner_team_key, confirmed_at, room_id, room_password FROM matches ORDER BY match_id DESC`).all(),
    entries: database.prepare(`SELECT match_id, team_key, user_key, identifiers FROM match_entries ORDER BY match_id DESC, team_key, user_key`).all()
      .map((entry) => ({ ...entry, identifiers: parseIdentifiers(entry.identifiers) })),
    payments: database.prepare(`SELECT id, user_key, amount, coins, utr, status, created_at, reviewed_at, review_note FROM payment_requests ORDER BY id DESC`).all(),
    withdrawals: database.prepare(`SELECT id, user_key, amount, method, details, status, created_at, reviewed_at, review_note FROM withdrawal_requests ORDER BY id DESC`).all(),
    kills: database.prepare(`SELECT id, match_id, user_key, kills, created_at FROM match_kills ORDER BY id DESC`).all(),
    ...getAdminNotifications(),
  }
}

function getAdminNotifications({ limit = 40 } = {}) {
  return {
    notifications: database.prepare('SELECT id, type, user_key, reference_id, title, body, read_at, created_at FROM admin_notifications ORDER BY id DESC LIMIT ?').all(limit),
    unreadNotifications: Number(database.prepare('SELECT COUNT(*) AS count FROM admin_notifications WHERE read_at IS NULL').get().count),
  }
}

function markAdminNotificationsRead({ ids } = {}) {
  if (Array.isArray(ids) && ids.length) {
    const statement = database.prepare('UPDATE admin_notifications SET read_at = CURRENT_TIMESTAMP WHERE id = ? AND read_at IS NULL')
    for (const id of ids) statement.run(Number(id))
  } else {
    database.prepare('UPDATE admin_notifications SET read_at = CURRENT_TIMESTAMP WHERE read_at IS NULL').run()
  }
  return getAdminNotifications()
}

// Looks a user up by key first, then by email, phone or gamer tag.
function findUser(query) {
  const value = normalizeKey(query)
  if (!value) throw new Error('Enter a user key, email, phone or gamer tag.')
  return getUserRow(value) || database.prepare(`
    SELECT ${userColumns} FROM users
    WHERE lower(email) = ? OR replace(phone, ' ', '') = replace(?, ' ', '') OR lower(display_name) = ?
    ORDER BY last_active_at DESC LIMIT 1
  `).get(value, value, value)
}

function getAdminUserDetail(query) {
  const user = findUser(query)
  if (!user) throw httpError(404, `No user found for "${String(query).trim()}".`)
  const key = user.user_key
  const lastSeen = database.prepare('SELECT MAX(last_seen) AS last_seen FROM active_sessions WHERE user_key = ?').get(key)?.last_seen
  const payments = database.prepare('SELECT id, amount, coins, utr, status, created_at, reviewed_at, review_note FROM payment_requests WHERE user_key = ? ORDER BY id DESC').all(key)
  const withdrawals = database.prepare('SELECT id, amount, method, details, status, created_at, reviewed_at, review_note FROM withdrawal_requests WHERE user_key = ? ORDER BY id DESC').all(key)
  const payouts = database.prepare('SELECT match_id, amount, created_at FROM payouts WHERE user_key = ? ORDER BY created_at DESC').all(key)
  const sum = (rows, status) => rows.filter((row) => !status || row.status === status).reduce((total, row) => total + Number(row.coins ?? row.amount), 0)
  return {
    user: { ...user, is_online: lastSeen && Date.now() - lastSeen < 60000 ? 1 : 0 },
    totals: {
      totalCoins: user.credit_coins + user.winning_coins,
      approvedTopups: sum(payments, 'approved'),
      pendingTopups: sum(payments, 'pending'),
      totalWinnings: sum(payouts),
      withdrawn: sum(withdrawals, 'approved'),
      pendingWithdrawals: sum(withdrawals, 'pending'),
    },
    payments,
    withdrawals,
    payouts,
    entries: database.prepare(`
      SELECT e.match_id, e.team_key, m.public_id, m.mode, m.entry_fee, m.match_timestamp, m.status, m.winner_team_key
      FROM match_entries e LEFT JOIN matches m ON m.match_id = e.match_id
      WHERE e.user_key = ? ORDER BY m.match_timestamp DESC
    `).all(key),
    transactions: database.prepare('SELECT id, wallet, amount, balance_after, reason, reference, note, created_at FROM wallet_transactions WHERE user_key = ? ORDER BY id DESC LIMIT 100').all(key),
  }
}

function adjustUserBalance({ userKey, amount, wallet = 'credit', note = '', displayName = '' }) {
  const normalizedUser = normalizeKey(userKey)
  const coins = Number(amount)
  if (!normalizedUser || !Number.isInteger(coins) || coins === 0) throw new Error('User and a non-zero whole coin amount are required.')
  transaction(() => {
    applyWalletChange({ userKey: normalizedUser, wallet, amount: coins, reason: coins > 0 ? 'admin_add' : 'admin_deduct', note: String(note).trim() })
    const cleanName = String(displayName || '').trim()
    if (cleanName) database.prepare('UPDATE users SET display_name = ? WHERE user_key = ?').run(cleanName, normalizedUser)
  })
  return getUserRow(normalizedUser)
}

function parseIdentifiers(value) {
  try {
    const parsed = JSON.parse(value || '[]')
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

// The player's joined matches, so every device shows the same entries. Room details are only
// sent from ten minutes before the start, as the match rules promise.
function getUserEntries(userKey, now = Date.now()) {
  return database.prepare(`
    SELECT e.match_id, e.identifiers, m.public_id, m.mode, m.entry_fee, m.match_timestamp, m.status, m.room_id, m.room_password
    FROM match_entries e JOIN matches m ON m.match_id = e.match_id
    WHERE e.user_key = ? ORDER BY m.match_timestamp DESC LIMIT 50
  `).all(userKey).map((entry) => {
    const startsAt = Number(entry.match_timestamp) || 0
    const showRoom = entry.status === 'open' && Boolean(entry.room_id) && (!startsAt || now >= startsAt - ROOM_REVEAL_MS)
    return {
      matchId: entry.match_id,
      publicId: entry.public_id,
      mode: entry.mode,
      entryFee: entry.entry_fee,
      matchTimestamp: startsAt,
      status: entry.status,
      identifiers: parseIdentifiers(entry.identifiers),
      roomId: showRoom ? entry.room_id : '',
      roomPassword: showRoom ? entry.room_password : '',
    }
  })
}

function getUserWallet(userKey, now = Date.now()) {
  const user = getUserRow(userKey)
  const creditCoins = Number(user?.credit_coins || 0)
  const winningCoins = Number(user?.winning_coins || 0)
  return {
    userKey,
    creditCoins,
    winningCoins,
    totalCoins: creditCoins + winningCoins,
    profile: user ? { name: user.display_name, email: user.email, phone: user.phone } : null,
    payments: database.prepare('SELECT id, amount, coins, utr, status, created_at, reviewed_at, review_note FROM payment_requests WHERE user_key = ? ORDER BY id DESC LIMIT 10').all(userKey),
    withdrawals: database.prepare('SELECT id, amount, method, status, created_at, reviewed_at, review_note FROM withdrawal_requests WHERE user_key = ? ORDER BY id DESC LIMIT 10').all(userKey),
    entries: getUserEntries(userKey, now),
  }
}

function getAuthorizedWallet({ userKey, password }, now = Date.now()) {
  return getUserWallet(authorizeUser(userKey, password), now)
}

function recordPaymentRequest({ userKey, password, amount, utr = '' }) {
  const normalizedUser = authorizeUser(userKey, password)
  const coins = Number(amount)
  if (!Number.isInteger(coins) || coins < 50) throw new Error('Top-ups must be at least 50 whole coins.')
  const cleanUtr = String(utr).trim().toUpperCase()
  if (!/^[A-Z0-9]{6,35}$/.test(cleanUtr)) throw new Error('Enter the UTR / transaction ID exactly as shown in your UPI app (letters and numbers only).')
  const duplicate = database.prepare("SELECT user_key FROM payment_requests WHERE utr = ? AND status <> 'rejected'").get(cleanUtr)
  if (duplicate) throw httpError(409, 'This UTR has already been submitted. Each payment can only be claimed once.')
  const now = Date.now()
  return transaction(() => {
    database.prepare("INSERT INTO users (user_key, status, last_active_at) VALUES (?, 'active', ?) ON CONFLICT(user_key) DO UPDATE SET last_active_at = excluded.last_active_at").run(normalizedUser, now)
    const { lastInsertRowid } = database.prepare('INSERT INTO payment_requests (user_key, amount, coins, utr) VALUES (?, ?, ?, ?)').run(normalizedUser, coins, coins, cleanUtr)
    const id = Number(lastInsertRowid)
    addAdminNotification({ type: 'payment', userKey: normalizedUser, referenceId: id, title: `Coin top-up: ${coins} coins`, body: `${normalizedUser} paid ₹${coins} · UTR ${cleanUtr}` })
    return database.prepare('SELECT id, user_key, amount, coins, utr, status, created_at FROM payment_requests WHERE id = ?').get(id)
  })
}

function reviewPaymentRequest({ id, decision, note = '' }) {
  const requestId = Number(id)
  if (!Number.isInteger(requestId) || !['approve', 'reject'].includes(decision)) throw new Error('A payment id and a decision of approve or reject are required.')
  return transaction(() => {
    const payment = database.prepare('SELECT * FROM payment_requests WHERE id = ?').get(requestId)
    if (!payment) throw httpError(404, 'Payment request not found.')
    if (payment.status !== 'pending') throw httpError(409, `This payment was already ${payment.status}.`)
    const status = decision === 'approve' ? 'approved' : 'rejected'
    database.prepare('UPDATE payment_requests SET status = ?, reviewed_at = CURRENT_TIMESTAMP, review_note = ? WHERE id = ?').run(status, String(note).trim(), requestId)
    if (status === 'approved') {
      applyWalletChange({ userKey: payment.user_key, wallet: 'credit', amount: payment.coins, reason: 'topup_approved', reference: `payment:${requestId}`, note: `UTR ${payment.utr}` })
    }
    markReferenceNotificationsRead('payment', requestId)
    return { payment: database.prepare('SELECT id, user_key, amount, coins, utr, status, created_at, reviewed_at, review_note FROM payment_requests WHERE id = ?').get(requestId), user: getUserRow(payment.user_key) }
  })
}

function cleanIdentifiers(identifiers, mode) {
  if (identifiers === undefined || identifiers === null) return []
  const teamSize = getTeamSize(mode)
  const names = Array.isArray(identifiers) ? identifiers.map((value) => String(value ?? '').trim()) : []
  if (names.length !== teamSize || names.some((name) => name.length < 3 || name.length > 24)) {
    throw new Error(teamSize === 1 ? 'Enter your in-game name or UID (3 to 24 characters).' : `Enter all ${teamSize} in-game names or UIDs (3 to 24 characters each).`)
  }
  return names
}

// Players can only join matches the server knows about, before they start and while there is room.
// The fee always comes from the stored match, never from the browser.
function recordMatchEntry({ matchId, identifiers, userKey, password }, now = Date.now()) {
  const normalizedUser = authorizeUser(userKey, password)
  const normalizedMatch = normalizeKey(matchId)
  if (!normalizedMatch) throw new Error('Invalid match entry.')
  ensureScheduledMatches(now)
  return transaction(() => {
    const match = database.prepare('SELECT match_id, public_id, mode, entry_fee, match_timestamp, status FROM matches WHERE match_id = ?').get(normalizedMatch)
    if (!match) throw httpError(404, 'This match is no longer available. Pick another match.')
    const names = cleanIdentifiers(identifiers, match.mode)
    const startsAt = Number(match.match_timestamp) || 0
    database.prepare("INSERT INTO users (user_key, status, last_active_at) VALUES (?, 'active', ?) ON CONFLICT(user_key) DO UPDATE SET last_active_at = excluded.last_active_at").run(normalizedUser, now)

    const existing = database.prepare('SELECT identifiers FROM match_entries WHERE match_id = ? AND user_key = ?').get(match.match_id, normalizedUser)
    if (existing) {
      if (names.length && JSON.stringify(names) !== JSON.stringify(parseIdentifiers(existing.identifiers))) {
        if (startsAt && now >= startsAt - EDIT_LOCK_MS) throw httpError(409, 'Player names are locked 1 hour before the match starts.')
        database.prepare('UPDATE match_entries SET identifiers = ? WHERE match_id = ? AND user_key = ?').run(JSON.stringify(names), match.match_id, normalizedUser)
      }
      return { charged: 0, wallet: getUserWallet(normalizedUser, now) }
    }
    if (match.status === 'confirmed') throw httpError(409, 'This match has already finished.')
    if (startsAt && now >= startsAt) throw httpError(409, 'This match has already started, so joining is closed. Pick an upcoming match.')
    if (joinedTeamCount(match.match_id) >= getMatchCapacity(match.mode).total) throw httpError(409, 'This match is full. Pick another match.')

    // Credit coins are spent first.
    const user = getUserRow(normalizedUser)
    const fromCredit = Math.min(user.credit_coins, match.entry_fee)
    const fromWinning = match.entry_fee - fromCredit
    if (fromWinning > user.winning_coins) throw httpError(402, `You need ${fromWinning - user.winning_coins} more coins to join this match.`)
    const note = `Joined match #${match.public_id || match.match_id}`
    if (fromCredit) applyWalletChange({ userKey: normalizedUser, wallet: 'credit', amount: -fromCredit, reason: 'match_entry', reference: match.match_id, note })
    if (fromWinning) applyWalletChange({ userKey: normalizedUser, wallet: 'winning', amount: -fromWinning, reason: 'match_entry', reference: match.match_id, note })
    database.prepare('INSERT INTO match_entries (match_id, team_key, user_key, identifiers) VALUES (?, ?, ?, ?)').run(match.match_id, normalizedUser, normalizedUser, JSON.stringify(names))
    return { charged: match.entry_fee, wallet: getUserWallet(normalizedUser, now) }
  })
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

// Matches from the last day onwards, with how many teams joined each so every player sees the same count.
function getPublicMatchCatalog(now = Date.now()) {
  ensureScheduledMatches(now)
  return database.prepare(`
    SELECT m.match_id, m.public_id, m.mode, m.description, m.entry_fee, m.match_timestamp, m.prize_pool, m.status,
      (SELECT COUNT(DISTINCT e.team_key) FROM match_entries e WHERE e.match_id = m.match_id) AS joined_count
    FROM matches m
    WHERE m.mode <> '' AND m.match_timestamp >= ?
    ORDER BY m.match_timestamp, m.match_id
  `).all(now - 24 * 60 * 60 * 1000)
}

// Winning coins are held as soon as a withdrawal is requested; rejecting the request refunds them.
function recordWithdrawalRequest({ userKey, password, amount, method, details = {} }) {
  const normalizedUser = authorizeUser(userKey, password)
  const coins = Number(amount)
  if (!Number.isInteger(coins) || coins < 50 || !['upi', 'bank'].includes(method)) throw new Error('Invalid withdrawal request.')
  return transaction(() => {
    const { lastInsertRowid } = database.prepare('INSERT INTO withdrawal_requests (user_key, amount, method, details) VALUES (?, ?, ?, ?)').run(normalizedUser, coins, method, JSON.stringify(details))
    const id = Number(lastInsertRowid)
    applyWalletChange({ userKey: normalizedUser, wallet: 'winning', amount: -coins, reason: 'withdrawal_hold', reference: `withdrawal:${id}`, note: `${method.toUpperCase()} withdrawal requested` })
    addAdminNotification({ type: 'withdrawal', userKey: normalizedUser, referenceId: id, title: `Withdrawal: ${coins} coins`, body: `${normalizedUser} requested ${coins} coins via ${method.toUpperCase()}` })
    return { id, wallet: getUserWallet(normalizedUser) }
  })
}

function reviewWithdrawalRequest({ id, decision, note = '' }) {
  const requestId = Number(id)
  if (!Number.isInteger(requestId) || !['approve', 'reject'].includes(decision)) throw new Error('A withdrawal id and a decision of approve or reject are required.')
  return transaction(() => {
    const withdrawal = database.prepare('SELECT * FROM withdrawal_requests WHERE id = ?').get(requestId)
    if (!withdrawal) throw httpError(404, 'Withdrawal request not found.')
    if (withdrawal.status !== 'pending') throw httpError(409, `This withdrawal was already ${withdrawal.status}.`)
    const status = decision === 'approve' ? 'approved' : 'rejected'
    database.prepare('UPDATE withdrawal_requests SET status = ?, reviewed_at = CURRENT_TIMESTAMP, review_note = ? WHERE id = ?').run(status, String(note).trim(), requestId)
    // Only refund what this request actually held; older requests were never held on the server.
    const held = -Number(database.prepare("SELECT COALESCE(SUM(amount), 0) AS held FROM wallet_transactions WHERE reference = ? AND reason = 'withdrawal_hold'").get(`withdrawal:${requestId}`).held)
    if (status === 'rejected' && held > 0) {
      applyWalletChange({ userKey: withdrawal.user_key, wallet: 'winning', amount: held, reason: 'withdrawal_refund', reference: `withdrawal:${requestId}`, note: String(note).trim() || 'Withdrawal rejected' })
    }
    markReferenceNotificationsRead('withdrawal', requestId)
    return { withdrawal: database.prepare('SELECT id, user_key, amount, method, details, status, created_at, reviewed_at, review_note FROM withdrawal_requests WHERE id = ?').get(requestId), user: getUserRow(withdrawal.user_key) }
  })
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

function joinedTeamCount(matchId) {
  return Number(database.prepare('SELECT COUNT(DISTINCT team_key) AS teams FROM match_entries WHERE match_id = ?').get(matchId).teams)
}

// Player-joined matches all store team_count 2, so the prize pool counts the teams that actually joined.
function countJoinedTeams(match) {
  return joinedTeamCount(match.match_id) || match.team_count
}

function getPayoutSummary(matchId) {
  const match = findMatch(matchId)
  const payouts = database.prepare('SELECT user_key, amount FROM payouts WHERE match_id = ? ORDER BY user_key').all(match.match_id)
  const totalPool = match.entry_fee * countJoinedTeams(match)
  return {
    matchId,
    status: match.status,
    entryFee: match.entry_fee,
    totalPool,
    payoutPool: payouts.reduce((total, payout) => total + payout.amount, 0),
    platformMargin: totalPool - payouts.reduce((total, payout) => total + payout.amount, 0),
    winnerTeamKey: match.winner_team_key,
    payouts,
  }
}

export {
  adjustUserBalance,
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
  loginUser,
  updateUserProfile,
  updateMatchDetails,
  verifyAdminSession,
  recordUserPresence,
  getLiveStats,
  registerOrUpdateUser,
  syncUsers,
  adminSetUserStatus,
  getAdminNotifications,
  markAdminNotificationsRead,
  getAdminUserDetail,
  getAuthorizedWallet,
  reviewPaymentRequest,
  reviewWithdrawalRequest,
}
