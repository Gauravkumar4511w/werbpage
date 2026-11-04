/* global process, Buffer */

import { AsyncLocalStorage } from 'node:async_hooks'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { createClient } from '@libsql/client'
import { signAdminSession, verifySignedAdminSession } from './admin-session.js'
import { EDIT_LOCK_MS, ROOM_REVEAL_MS, getMatchCapacity, getScheduledMatches, getTeamSize } from './match-schedule.js'
import { verifyGoogleCredential } from './google-auth.js'
import { OTP_MAX_ATTEMPTS, OTP_RESEND_MS, deliverOtp, generateOtp, maskEmail, normalizeEmail, otpMatches, readOtpToken, signOtpToken } from './otp.js'

try { process.loadEnvFile?.() } catch { /* Deployed environments may not have a local .env file. */ }

// Production data lives in Turso, a hosted SQLite database, so it survives serverless restarts and
// deploys. Without TURSO_DATABASE_URL the app keeps using a local SQLite file; on Vercel that file
// is in /tmp and is lost whenever the function restarts.
const remote = Boolean(process.env.TURSO_DATABASE_URL)
const scrypt = promisify(crypto.scrypt)

function localDatabaseUrl() {
  const serverless = process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME
  let directory = serverless ? '/tmp/arenacore' : process.env.DATABASE_DIR || path.join(process.cwd(), 'data')
  try {
    fs.mkdirSync(directory, { recursive: true })
  } catch {
    directory = '/tmp/arenacore'
    fs.mkdirSync(directory, { recursive: true })
  }
  if (serverless) console.warn('TURSO_DATABASE_URL is not set, so data is kept in /tmp and lost when the function restarts.')
  return `file:${path.join(directory, 'arenacore.sqlite')}`
}

const client = createClient(remote
  ? { url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN }
  : { url: localDatabaseUrl() })

async function migrate() {
  // Turso runs each request on its own connection, so connection pragmas only apply to the local file.
  if (!remote) await client.executeMultiple('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
  await client.executeMultiple(`
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

  CREATE TABLE IF NOT EXISTS otp_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    target TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('send', 'fail')),
    nonce TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS otp_events_target ON otp_events (target, kind, created_at);

  CREATE TABLE IF NOT EXISTS uploads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL CHECK (kind IN ('payment', 'withdrawal')),
    reference_id INTEGER NOT NULL,
    user_key TEXT NOT NULL,
    mime TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS uploads_reference ON uploads (kind, reference_id);
  `)
  // Reading every table's columns first is one round trip, instead of one failing ALTER per column
  // on every cold start; with Turso each of those is a network call.
  const columns = await client.execute(
    "SELECT m.name || '.' || p.name AS col FROM sqlite_master m JOIN pragma_table_info(m.name) p WHERE m.type = 'table'",
  ).then((result) => new Set(result.rows.map((row) => row.col)), () => new Set())
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
  // Accounts from before sign-up OTP count as verified; browser re-syncs insert 0 explicitly.
  "ALTER TABLE users ADD COLUMN contact_verified INTEGER NOT NULL DEFAULT 1",
  // A random key handed out by Google sign-in, accepted like the password. See authorizeUser().
  "ALTER TABLE users ADD COLUMN login_secret TEXT NOT NULL DEFAULT ''",
  // 1 once the owner proved the profile email (reset code or Google). Only proven emails sign in with
  // Google, so typing someone else's email into a profile never hands that person your account.
  "ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0",
  ]) {
    const [, table, column] = /ALTER TABLE (\w+) ADD COLUMN (\w+)/.exec(statement)
    if (columns.has(`${table}.${column}`)) continue
    try {
      await client.execute(statement)
      // Emails saved before this check existed keep working with Google sign-in.
      if (column === 'email_verified') await client.execute("UPDATE users SET email_verified = 1 WHERE email <> ''")
    } catch (error) {
      if (!String(error.message).includes('duplicate column name')) throw error
    }
  }
  // Player passwords used to be stored as typed. Hash any that still are; the password = ? check
  // keeps two instances starting at once from hashing the same row twice.
  const plain = await client.execute("SELECT user_key, password FROM users WHERE password <> '' AND password NOT LIKE 'scrypt$%'")
  for (const row of plain.rows) {
    await client.execute({ sql: 'UPDATE users SET password = ? WHERE user_key = ? AND password = ?', args: [await hashUserPassword(row.password), row.user_key, row.password] })
  }
}

const ready = migrate()
ready.catch((error) => console.error('Database setup failed:', error))

// Queries inside transaction() run on its connection, including those in helpers it calls.
const currentTransaction = new AsyncLocalStorage()
// Settles when the open transaction ends. Transactions run one at a time in this process, and other
// queries wait for the open one, so the local SQLite file never reports "database is locked".
let openTransaction = null

async function execute(sql, args) {
  await ready
  const tx = currentTransaction.getStore()
  if (!tx) while (openTransaction) await openTransaction
  return (tx || client).execute({ sql, args })
}

// The same prepare().get/all/run shape as node:sqlite, which the queries below were written for,
// except that every call returns a promise.
const database = {
  prepare: (sql) => ({
    get: async (...args) => (await execute(sql, args)).rows[0],
    all: async (...args) => (await execute(sql, args)).rows,
    run: async (...args) => {
      const result = await execute(sql, args)
      return { changes: result.rowsAffected, lastInsertRowid: Number(result.lastInsertRowid ?? 0) }
    },
  }),
}

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase()
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status })
}

// Runs work() as one write transaction. A call made while one is already open joins it.
async function transaction(work) {
  if (currentTransaction.getStore()) return work()
  while (openTransaction) await openTransaction
  let finished
  openTransaction = new Promise((resolve) => { finished = resolve })
  try {
    await ready
    const tx = await client.transaction('write')
    try {
      const result = await currentTransaction.run(tx, work)
      await tx.commit()
      return result
    } catch (error) {
      await tx.rollback().catch(() => {})
      throw error
    } finally {
      tx.close()
    }
  } finally {
    openTransaction = null
    finished()
  }
}

const userColumns = 'user_key, display_name, email, phone, credit_coins, winning_coins, status, last_active_at, created_at'
const walletColumns = { credit: 'credit_coins', winning: 'winning_coins' }

async function getUserRow(userKey) {
  return await database.prepare(`SELECT ${userColumns} FROM users WHERE user_key = ?`).get(userKey)
}

// Every balance change goes through here so the ledger always explains the balance.
// Call it inside await transaction(); it throws rather than let a balance go below zero.
async function applyWalletChange({ userKey, wallet, amount, reason, reference = '', note = '' }) {
  const column = walletColumns[wallet]
  if (!column) throw new Error('Wallet must be "credit" or "winning".')
  await database.prepare("INSERT INTO users (user_key, status) VALUES (?, 'active') ON CONFLICT(user_key) DO NOTHING").run(userKey)
  const current = Number((await database.prepare(`SELECT ${column} AS balance FROM users WHERE user_key = ?`).get(userKey)).balance)
  const next = current + amount
  if (next < 0) throw new Error(`Not enough ${wallet} coins. Current ${wallet} balance is ${current}.`)
  await database.prepare(`UPDATE users SET ${column} = ? WHERE user_key = ?`).run(next, userKey)
  await database.prepare('INSERT INTO wallet_transactions (user_key, wallet, amount, balance_after, reason, reference, note) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(userKey, wallet, amount, next, reason, String(reference), String(note))
  return next
}

async function addAdminNotification({ type, userKey = '', referenceId = null, title, body = '' }) {
  await database.prepare('INSERT INTO admin_notifications (type, user_key, reference_id, title, body) VALUES (?, ?, ?, ?, ?)')
    .run(type, userKey, referenceId, title, body)
}

async function markReferenceNotificationsRead(type, referenceId) {
  await database.prepare('UPDATE admin_notifications SET read_at = CURRENT_TIMESTAMP WHERE type = ? AND reference_id = ? AND read_at IS NULL').run(type, referenceId)
}

function passwordMatches(given, stored) {
  const givenBuffer = Buffer.from(String(given || ''))
  const storedBuffer = Buffer.from(String(stored || ''))
  return givenBuffer.length === storedBuffer.length && crypto.timingSafeEqual(givenBuffer, storedBuffer)
}

// Player passwords are stored as "scrypt$salt$hash". Rows from before hashing held the password as
// typed; migrate() hashes them, and verifyUserPassword still accepts one until it has run.
async function hashUserPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex')
  return `scrypt$${salt}$${(await scrypt(String(password), salt, 64)).toString('hex')}`
}

async function verifyUserPassword(given, stored) {
  const value = String(stored || '')
  if (!value.startsWith('scrypt$')) return Boolean(value) && passwordMatches(given, value)
  const [, salt, hash] = value.split('$')
  const actual = await scrypt(String(given || ''), salt, 64)
  const expected = Buffer.from(hash, 'hex')
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected)
}

// Every sign-in hands the browser this random key. Wallet, match and profile requests send it in
// place of the password, so the password itself is never kept on the device or checked each time.
async function ensureLoginSecret(userKey) {
  const current = (await database.prepare('SELECT login_secret FROM users WHERE user_key = ?').get(userKey))?.login_secret
  if (current) return current
  await database.prepare("UPDATE users SET login_secret = ? WHERE user_key = ? AND login_secret = ''").run(crypto.randomBytes(32).toString('hex'), userKey)
  return (await database.prepare('SELECT login_secret FROM users WHERE user_key = ?').get(userKey)).login_secret
}

const DEACTIVATED_MESSAGE = 'This account has been deactivated. Contact support.'

// Every wallet, match and profile request must present the account's login secret, or (from a
// browser signed in before login secrets existed) the password itself. An account without a
// password cannot be used until its owner sets one by signing up or with "Forgot password".
async function authorizeUser(userKey, password) {
  const normalizedUser = normalizeKey(userKey)
  if (!normalizedUser) throw new Error('User key is required.')
  const stored = await database.prepare('SELECT password, login_secret, status FROM users WHERE user_key = ?').get(normalizedUser)
  if (!stored) throw httpError(403, 'Account not found. Please log in again.')
  if (stored.status === 'inactive') throw httpError(403, DEACTIVATED_MESSAGE)
  if (!stored.password) throw httpError(403, 'This account has no password yet. Sign up with its email, or use "Forgot password?", to set one.')
  if (stored.login_secret && passwordMatches(password, stored.login_secret)) return normalizedUser
  if (await verifyUserPassword(password, stored.password)) return normalizedUser
  throw httpError(403, 'Could not verify this account. Please log in again.')
}

// Phone numbers are typed many ways ("+91 98765 43210", "9876543210"); compare the last ten digits.
function phoneTail(value) {
  const digits = String(value || '').replace(/\D/g, '')
  return digits.length >= 10 ? digits.slice(-10) : ''
}

// Accounts were only kept in the browser that created them, so logging in on a phone failed.
// This lets any device log in with the email or mobile number and password stored on the server.
async function loginUser({ login, password }) {
  const value = normalizeKey(login)
  if (!value || !password) throw httpError(400, 'Enter your email or mobile number and password.')
  const tail = phoneTail(value)
  const candidates = (await database.prepare(`
    SELECT user_key, display_name, email, phone, password, status FROM users
    WHERE password <> '' AND (
      user_key = ? OR lower(email) = ?
      OR (? <> '' AND (replace(replace(phone, ' ', ''), '-', '') LIKE '%' || ? OR replace(replace(user_key, ' ', ''), '-', '') LIKE '%' || ?))
    )
    ORDER BY last_active_at DESC
  `).all(value, value, tail, tail, tail))
    .filter((user) => user.user_key === value || user.email === value || (tail && (phoneTail(user.phone) === tail || phoneTail(user.user_key) === tail)))
  let user = null
  for (const candidate of candidates) {
    if (await verifyUserPassword(password, candidate.password)) {
      user = candidate
      break
    }
  }
  if (!user) throw httpError(401, 'No account found with these credentials. Check your details or sign up.')
  if (user.status === 'inactive') throw httpError(403, DEACTIVATED_MESSAGE)
  return { user: publicUser(user), loginSecret: await ensureLoginSecret(user.user_key) }
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

async function ensureAdmin() {
  try { process.loadEnvFile?.() } catch { /* Deployed environments may not have a local .env file. */ }
  const rawEmails = process.env.ADMIN_EMAIL || ''
  // Admin login stays disabled until ADMIN_PASSWORD is set, so there is no default password.
  const password = process.env.ADMIN_PASSWORD || ''
  if (!password) return false

  await database.prepare(`
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

  // An email taken out of ADMIN_EMAIL loses access, along with the old password stored for it.
  const placeholders = Array.from(emails, () => '?').join(', ')
  await database.prepare(`DELETE FROM admins WHERE email NOT IN (${placeholders})`).run(...emails)

  for (const email of emails) {
    const existing = await database.prepare('SELECT email, password_hash FROM admins WHERE email = ?').get(email)
    if (!existing) {
      await database.prepare('INSERT INTO admins (email, password_hash) VALUES (?, ?)').run(email, hashPassword(password))
    } else if (!verifyPassword(password, existing.password_hash)) {
      await database.prepare('UPDATE admins SET password_hash = ? WHERE email = ?').run(hashPassword(password), email)
    }
  }
  return true
}

async function authenticateAdmin(email, password) {
  if (!await ensureAdmin()) return false
  if (!password) return false
  const inputEmail = normalizeKey(email)
  let admin = await database.prepare('SELECT password_hash FROM admins WHERE email = ?').get(inputEmail)
  if (!admin) {
    if (inputEmail.includes('gaurau')) {
      admin = await database.prepare('SELECT password_hash FROM admins WHERE email = ?').get(inputEmail.replace('gaurau', 'gaurav'))
    } else if (inputEmail.includes('gaurav')) {
      admin = await database.prepare('SELECT password_hash FROM admins WHERE email = ?').get(inputEmail.replace('gaurav', 'gaurau'))
    } else if (inputEmail === 'admin' || inputEmail === 'admin@arenacore.com' || inputEmail === 'admin@gmail.com') {
      admin = await database.prepare('SELECT password_hash FROM admins ORDER BY email LIMIT 1').get()
    }
  }
  return Boolean(admin && verifyPassword(password, admin.password_hash))
}

async function createAdminSession() {
  const expiresInSeconds = 8 * 60 * 60
  const expiresAt = Date.now() + expiresInSeconds * 1000
  const secret = process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_PASSWORD
  if (secret) {
    return { token: signAdminSession(secret, expiresAt), expiresIn: expiresInSeconds }
  }
  const token = crypto.randomBytes(32).toString('hex')
  await database.prepare('INSERT INTO admin_sessions (token, expires_at) VALUES (?, ?)').run(token, expiresAt)
  return { token, expiresIn: expiresInSeconds }
}

async function verifyAdminSession(token) {
  if (!token) return false
  if (token.startsWith('v1.')) {
    return verifySignedAdminSession(token, process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_PASSWORD)
  }
  const session = await database.prepare('SELECT token, expires_at FROM admin_sessions WHERE token = ?').get(token)
  if (!session) return false
  if (session.expires_at <= Date.now()) {
    await database.prepare('DELETE FROM admin_sessions WHERE token = ?').run(token)
    return false
  }
  return true
}

async function deleteAdminSession(token) {
  if (!token) return
  await database.prepare('DELETE FROM admin_sessions WHERE token = ?').run(token)
}

async function registerMatch({ matchId, entryFee, teams }) {
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
  await transaction(async () => {
    await insert.run(normalizedMatchId, fee, normalizedTeams.length)
    for (const team of normalizedTeams) {
      for (const userKey of team.members) {
        await insertEntry.run(normalizedMatchId, team.teamKey, userKey)
        await database.prepare('INSERT INTO users (user_key) VALUES (?) ON CONFLICT(user_key) DO NOTHING').run(userKey)
      }
    }
  })
}

function normalizePublicId(value) {
  return String(value || '').trim().replace(/^#/, '').padStart(6, '0')
}

async function findMatch(matchIdOrPublicId) {
  const value = String(matchIdOrPublicId || '').trim()
  const publicId = normalizePublicId(value)
  return await database.prepare('SELECT * FROM matches WHERE match_id = ? OR public_id = ?').get(value.toLowerCase(), publicId)
}

async function updateMatchDetails({ matchId, publicId, entryFee, matchTimestamp, prizePool, description, roomId, roomPassword }) {
  const match = await findMatch(matchId || publicId)
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
  await database.prepare('UPDATE matches SET entry_fee = ?, match_timestamp = ?, prize_pool = ?, description = ?, room_id = ?, room_password = ? WHERE match_id = ?')
    .run(nextFee, nextTime, nextPrize, nextDescription, nextRoomId, nextRoomPassword, match.match_id)
  return await findMatch(match.match_id)
}

// Public ids come only from the server. Browsers used to number matches from "today", so the same
// number meant a different match every day and joining failed on the unique public_id.
async function nextPublicId() {
  const last = (await database.prepare('SELECT MAX(CAST(public_id AS INTEGER)) AS last FROM (SELECT public_id FROM matches UNION ALL SELECT public_id FROM deleted_matches)').get()).last
  return String(Number(last || 0) + 1).padStart(6, '0')
}

// Adds any daily matches for the next few days that are not stored yet. Deleted matches stay deleted.
async function ensureScheduledMatches(now = Date.now()) {
  const scheduled = getScheduledMatches(now)
  if (!scheduled.length) return
  const ids = scheduled.map((match) => normalizeKey(match.id))
  const placeholders = ids.map(() => '?').join(', ')
  // One query for the whole schedule: the catalog runs this on every visit.
  const missing = async () => {
    const known = new Set((await database.prepare(`
      SELECT match_id FROM matches WHERE match_id IN (${placeholders})
      UNION SELECT match_id FROM deleted_matches WHERE match_id IN (${placeholders})
    `).all(...ids, ...ids)).map((row) => row.match_id))
    return scheduled.filter((match) => !known.has(normalizeKey(match.id)))
  }
  if (!(await missing()).length) return
  await transaction(async () => {
    const insert = database.prepare('INSERT INTO matches (match_id, public_id, mode, entry_fee, match_timestamp, team_count) VALUES (?, ?, ?, ?, ?, 2)')
    for (const match of await missing()) {
      await insert.run(normalizeKey(match.id), await nextPublicId(), match.mode, match.entryFee, match.matchTimestamp)
    }
  })
}

async function createAdminMatch({ mode, entryFee, matchTimestamp, prizePool = null, description = '' }) {
  const normalizedMode = String(mode || '').trim()
  const fee = Number(entryFee)
  const timestamp = Number(matchTimestamp)
  const prize = prizePool === '' || prizePool === null || prizePool === undefined ? null : Number(prizePool)
  if (!normalizedMode || !Number.isInteger(fee) || fee <= 0 || !Number.isFinite(timestamp) || (prize !== null && (!Number.isInteger(prize) || prize < 0))) {
    throw new Error('Mode, entry fee, date/time, and a valid prize are required.')
  }
  const publicId = await nextPublicId()
  const matchId = `admin-${publicId}-${Date.now()}`
  await database.prepare('INSERT INTO matches (match_id, public_id, mode, description, entry_fee, match_timestamp, prize_pool, team_count) VALUES (?, ?, ?, ?, ?, ?, ?, 2)').run(matchId, publicId, normalizedMode, String(description), fee, timestamp, prize)
  return await database.prepare('SELECT * FROM matches WHERE match_id = ?').get(matchId)
}

async function deleteAdminMatch(matchIdOrPublicId) {
  const found = await findMatch(matchIdOrPublicId)
  if (!found) throw new Error('Match not found.')
  let match = found
  const refunds = await transaction(async () => {
    // Read again inside the transaction, so a result confirmed a moment ago is never refunded.
    match = await database.prepare('SELECT * FROM matches WHERE match_id = ?').get(found.match_id)
    if (!match) throw new Error('Match not found.')
    if (match.status === 'confirmed') throw new Error('Confirmed matches cannot be deleted.')
    // Give back every entry fee that was charged for this match.
    const paid = await database.prepare(`
      SELECT user_key, wallet, -SUM(amount) AS paid FROM wallet_transactions
      WHERE reference = ? AND reason IN ('match_entry', 'match_refund')
      GROUP BY user_key, wallet HAVING paid > 0
    `).all(match.match_id)
    for (const row of paid) {
      await applyWalletChange({ userKey: row.user_key, wallet: row.wallet, amount: row.paid, reason: 'match_refund', reference: match.match_id, note: `Match #${match.public_id || match.match_id} deleted` })
    }
    await database.prepare('DELETE FROM match_entries WHERE match_id = ?').run(match.match_id)
    await database.prepare('DELETE FROM payouts WHERE match_id = ?').run(match.match_id)
    await database.prepare('DELETE FROM match_kills WHERE match_id = ?').run(match.match_id)
    await database.prepare('DELETE FROM matches WHERE match_id = ?').run(match.match_id)
    await database.prepare('INSERT OR REPLACE INTO deleted_matches (match_id, public_id) VALUES (?, ?)').run(match.match_id, match.public_id)
    return paid.length
  })
  return { deleted: true, publicId: match.public_id, refunds }
}

async function confirmMatchResult({ matchId, winnerTeamKey }) {
  const normalizedMatchId = normalizeKey(matchId)
  const normalizedWinner = normalizeKey(winnerTeamKey)
  const found = await findMatch(normalizedMatchId)
  if (!found) throw new Error('Match is not registered.')

  // Everything is read inside the transaction, so two confirms (or a confirm and a delete) arriving
  // together can never pay twice: the second one sees the match already confirmed or gone.
  await transaction(async () => {
    const match = await database.prepare('SELECT * FROM matches WHERE match_id = ?').get(found.match_id)
    if (!match) throw new Error('Match is not registered.')
    if (match.status === 'confirmed') return

    const winningUsers = await database.prepare(`
      SELECT user_key FROM match_entries WHERE match_id = ? AND team_key = ? ORDER BY user_key
    `).all(match.match_id, normalizedWinner)
    if (!winningUsers.length) throw new Error('Winning team is not registered for this match.')

    const totalPool = match.entry_fee * await countJoinedTeams(match)
    const payoutPool = match.prize_pool === null || match.prize_pool === undefined
      ? Math.floor(totalPool * 0.8)
      : match.prize_pool
    const baseShare = Math.floor(payoutPool / winningUsers.length)
    const remainder = payoutPool % winningUsers.length

    await database.prepare(`UPDATE matches SET status = 'confirmed', winner_team_key = ?, confirmed_at = CURRENT_TIMESTAMP WHERE match_id = ?`)
      .run(normalizedWinner, match.match_id)
    const insertPayout = database.prepare('INSERT INTO payouts (match_id, user_key, amount) VALUES (?, ?, ?)')
    for (const [index, user] of winningUsers.entries()) {
      const amount = baseShare + (index < remainder ? 1 : 0)
      if (amount <= 0) continue
      await insertPayout.run(match.match_id, user.user_key, amount)
      await applyWalletChange({ userKey: user.user_key, wallet: 'winning', amount, reason: 'match_win', reference: match.match_id, note: `Won match #${match.public_id || match.match_id}` })
    }
  })
  return await getPayoutSummary(normalizedMatchId)
}

async function recordUserPresence({ sessionId, userKey = '', ip = '' }) {
  const now = Date.now()
  const cutoff = now - 60000
  const normalizedSession = String(sessionId || '').trim() || crypto.randomUUID()
  const normalizedUser = normalizeKey(userKey)

  await database.prepare('DELETE FROM active_sessions WHERE last_seen < ?').run(cutoff)

  await database.prepare(`
    INSERT INTO active_sessions (session_id, user_key, ip, last_seen)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET
      user_key = CASE WHEN excluded.user_key <> '' THEN excluded.user_key ELSE active_sessions.user_key END,
      ip = CASE WHEN excluded.ip <> '' THEN excluded.ip ELSE active_sessions.ip END,
      last_seen = excluded.last_seen
  `).run(normalizedSession, normalizedUser, String(ip || ''), now)

  // Heartbeats need no login, so they only touch accounts that exist. Creating one here let anyone
  // reserve another person's email before that person signed up.
  if (normalizedUser) {
    await database.prepare('UPDATE users SET last_active_at = ? WHERE user_key = ?').run(now, normalizedUser)
  }

  return await getLiveStats()
}

async function getLiveStats() {
  const now = Date.now()
  const cutoff = now - 60000
  await database.prepare('DELETE FROM active_sessions WHERE last_seen < ?').run(cutoff)

  const activeSessions = await database.prepare('SELECT session_id, user_key FROM active_sessions WHERE last_seen >= ?').all(cutoff)
  const totalUsersRow = await database.prepare('SELECT COUNT(*) as count FROM users').get()
  const activeUsersRow = await database.prepare("SELECT COUNT(*) as count FROM users WHERE status != 'inactive'").get()

  const onlineSessionsCount = activeSessions.length
  const onlineUserKeys = new Set(activeSessions.map((s) => s.user_key).filter(Boolean))
  const onlineUsersCount = onlineUserKeys.size
  const totalUsers = totalUsersRow?.count || 0
  const activeUsers = activeUsersRow?.count || 0

  // "Players online" counts the browsers seen in the last minute, and at least the visitor reading it.
  const liveCount = Math.max(onlineSessionsCount, 1)

  return {
    liveCount,
    onlineSessionsCount,
    onlineUsersCount,
    activeUsersCount: activeUsers,
    totalUsers,
  }
}

// Balances are never set here: browsers re-sync their users on every visit, so accepting a
// coin value would re-credit it each time. Coins only move through await applyWalletChange().
// Players (trusted = false) must give the stored password to change an existing account, and
// cannot change its status, so re-registering never takes over a number or undoes a deactivation.
// A player who proved the contact with an OTP (verified = true) may claim an account that only a
// browser re-sync created, because nobody proved owning that email or number.
async function registerOrUpdateUser({ userKey, displayName = '', email = '', phone = '', password = '', status = 'active' }, { trusted = false, verified = trusted } = {}) {
  const normalizedUser = normalizeKey(userKey || email || phone)
  if (!normalizedUser) throw new Error('User email, phone, or username is required.')
  const now = Date.now()
  const cleanName = String(displayName || '').trim()
  const cleanEmail = String(email || '').trim().toLowerCase()
  const cleanPhone = String(phone || '').trim()
  const cleanPassword = String(password || '')
  const cleanStatus = status === 'inactive' ? 'inactive' : 'active'

  const existing = await database.prepare('SELECT password, contact_verified FROM users WHERE user_key = ?').get(normalizedUser)
  // Nobody proved owning an account that has no password or an unverified contact, so the person who
  // proves the email with a code takes it over (with any coins the admin added).
  const claimable = verified && existing && (!existing.contact_verified || !existing.password)
  if (!trusted && !claimable && existing?.password && !await verifyUserPassword(cleanPassword, existing.password)) {
    throw httpError(409, 'An account already exists with this email or mobile number. Please log in.')
  }
  if (!trusted && !existing && await findContactConflict({ userKey: normalizedUser, email: cleanEmail, phone: cleanPhone }, { provenEmailsOnly: verified })) {
    throw httpError(409, 'An account already exists with this email or mobile number. Please log in.')
  }

  await database.prepare(`
    INSERT INTO users (user_key, display_name, email, phone, password, status, last_active_at, contact_verified)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_key) DO UPDATE SET
      display_name = CASE WHEN excluded.display_name <> '' THEN excluded.display_name ELSE users.display_name END,
      email = CASE WHEN excluded.email <> '' THEN excluded.email ELSE users.email END,
      phone = CASE WHEN excluded.phone <> '' THEN excluded.phone ELSE users.phone END,
      password = CASE WHEN excluded.password <> '' THEN excluded.password ELSE users.password END,
      status = CASE WHEN ? THEN excluded.status ELSE users.status END,
      last_active_at = excluded.last_active_at,
      contact_verified = CASE WHEN excluded.contact_verified = 1 THEN 1 ELSE users.contact_verified END
  `).run(normalizedUser, cleanName, cleanEmail, cleanPhone, cleanPassword ? await hashUserPassword(cleanPassword) : '', cleanStatus, now, verified ? 1 : 0, trusted ? 1 : 0)
  // Whoever re-synced the account may hold its login secret, so the verified owner gets a new one.
  if (claimable) await database.prepare("UPDATE users SET login_secret = '' WHERE user_key = ?").run(normalizedUser)

  return await getUserRow(normalizedUser)
}

// New accounts sign up with an email address, which is also their user key.
function readSignup({ email = '', displayName = '' }) {
  const cleanName = String(displayName || '').trim()
  if (cleanName.length < 3 || cleanName.length > 24) throw new Error('Choose a gamer tag with 3 to 24 characters.')
  const cleanEmail = normalizeEmail(email)
  if (!cleanEmail) throw new Error('Enter a valid Gmail or email address.')
  return { userKey: cleanEmail, displayName: cleanName, email: cleanEmail, phone: '' }
}

async function assertSignupAvailable(signup) {
  const existing = await database.prepare('SELECT password, contact_verified FROM users WHERE user_key = ?').get(signup.userKey)
  if (existing?.password && existing.contact_verified) {
    throw httpError(409, 'An account already exists with this email. Please log in.')
  }
  // An email typed into someone else's profile, and never proven, does not block its real owner.
  const conflict = await findContactConflict(signup, { provenEmailsOnly: true })
  if (conflict) throw httpError(409, conflict)
}

// Emails a code. Limits are per address and per purpose: one code every 30 seconds and five an hour,
// so asking for sign-up codes never uses up the owner's password-reset codes. A send event's nonce
// column holds its purpose.
async function sendOtpCode(purpose, email, now) {
  // The limit is checked and the send recorded in one transaction, so requests arriving together
  // cannot all pass the check.
  const eventId = await transaction(async () => {
    await database.prepare('DELETE FROM otp_events WHERE created_at < ?').run(now - 24 * 60 * 60 * 1000)
    const sends = await database.prepare("SELECT created_at FROM otp_events WHERE target = ? AND kind = 'send' AND nonce = ? AND created_at > ? ORDER BY created_at DESC")
      .all(email, purpose, now - 60 * 60 * 1000)
    if (sends.length && now - sends[0].created_at < OTP_RESEND_MS) {
      throw httpError(429, `Please wait ${Math.ceil((OTP_RESEND_MS - (now - sends[0].created_at)) / 1000)} seconds before asking for a new code.`)
    }
    if (sends.length >= 5) throw httpError(429, 'Too many codes requested. Try again in an hour.')
    return (await database.prepare("INSERT INTO otp_events (target, kind, nonce, created_at) VALUES (?, 'send', ?, ?)").run(email, purpose, now)).lastInsertRowid
  })

  const otp = generateOtp()
  const { token, expiresAt } = signOtpToken({ purpose, target: email, otp, now })
  try {
    const delivery = await deliverOtp({ purpose, email, otp })
    return { otpToken: token, expiresAt, resendAfterMs: OTP_RESEND_MS, sentTo: maskEmail(email), ...delivery }
  } catch (error) {
    // A code that never arrived does not count against the limit.
    await database.prepare('DELETE FROM otp_events WHERE id = ?').run(eventId)
    throw error
  }
}

// Throws unless the code matches the one emailed to this address for this purpose. The count, the
// comparison and the recorded failure run in one transaction: guesses sent in parallel are checked
// one after another, so a code still locks after five wrong tries.
async function checkOtpCode({ purpose, email, otpToken, otp }, now) {
  const token = readOtpToken(otpToken, now)
  if (!token || token.purpose !== purpose || token.target !== email) {
    throw httpError(400, 'Verify your email first. Ask for a new code.')
  }
  if (token.expired) throw httpError(400, 'This code has expired. Ask for a new one.')
  const wrongCode = await transaction(async () => {
    const failures = Number((await database.prepare("SELECT COUNT(*) AS count FROM otp_events WHERE kind = 'fail' AND nonce = ?").get(token.nonce)).count)
    if (failures >= OTP_MAX_ATTEMPTS) throw httpError(429, 'Too many wrong codes. Ask for a new one.')
    if (otpMatches(token, otp)) return null
    await database.prepare("INSERT INTO otp_events (target, kind, nonce, created_at) VALUES (?, 'fail', ?, ?)").run(email, token.nonce, now)
    const left = OTP_MAX_ATTEMPTS - failures - 1
    return httpError(400, left > 0 ? `Wrong code. ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'Too many wrong codes. Ask for a new one.')
  })
  // Thrown after the transaction commits, so the wrong try stays counted.
  if (wrongCode) throw wrongCode
}

function readNewPassword(password) {
  const clean = String(password || '')
  if (clean.trim().length < 6) throw new Error('Your password must be at least 6 characters.')
  return clean
}

async function requestSignupOtp(body, now = Date.now()) {
  const signup = readSignup(body)
  await assertSignupAvailable(signup)
  return await sendOtpCode('signup', signup.email, now)
}

async function registerVerifiedUser(body, now = Date.now()) {
  const signup = readSignup(body)
  await checkOtpCode({ purpose: 'signup', email: signup.email, otpToken: body.otpToken, otp: body.otp }, now)
  const password = readNewPassword(body.password)
  await assertSignupAvailable(signup)
  const user = await registerOrUpdateUser({ ...signup, password }, { verified: true })
  return { user, loginSecret: await ensureLoginSecret(user.user_key) }
}

// The account this email belongs to: its user key, or the email saved on a mobile-number account.
// provenOnly skips profile emails nobody proved owning, for sign-ins that trust the email alone.
async function findUserByEmail(email, { provenOnly = false } = {}) {
  return await database.prepare(`
    SELECT ${userColumns}, contact_verified, login_secret FROM users
    WHERE user_key = ? OR (lower(email) = ? AND (? = 0 OR email_verified = 1))
    ORDER BY user_key = ? DESC, last_active_at DESC LIMIT 1
  `).get(email, email, provenOnly ? 1 : 0, email)
}

function publicUser(user) {
  return { userKey: user.user_key, name: user.display_name || user.user_key, email: user.email, phone: user.phone }
}

async function requestPasswordResetOtp({ email } = {}, now = Date.now()) {
  const cleanEmail = normalizeEmail(email)
  if (!cleanEmail) throw new Error('Enter the email address of your account.')
  if (!await findUserByEmail(cleanEmail)) throw httpError(404, 'No account uses this email. Check it, or sign up.')
  return await sendOtpCode('reset', cleanEmail, now)
}

// Setting a new password also replaces the login secret, so a reset signs out every other device.
async function resetPassword({ email, otpToken, otp, password } = {}, now = Date.now()) {
  const cleanEmail = normalizeEmail(email)
  if (!cleanEmail) throw new Error('Enter the email address of your account.')
  await checkOtpCode({ purpose: 'reset', email: cleanEmail, otpToken, otp }, now)
  const newPassword = readNewPassword(password)
  const user = await findUserByEmail(cleanEmail)
  if (!user) throw httpError(404, 'No account uses this email. Check it, or sign up.')
  const loginSecret = crypto.randomBytes(32).toString('hex')
  // The code reached this email, so the account's owner has now proven it.
  await database.prepare('UPDATE users SET password = ?, login_secret = ?, contact_verified = 1, email_verified = CASE WHEN lower(email) = ? THEN 1 ELSE email_verified END, last_active_at = ? WHERE user_key = ?')
    .run(await hashUserPassword(newPassword), loginSecret, cleanEmail, now, user.user_key)
  return { user: publicUser(user), loginSecret }
}

// Google gives names like "Gaurav Kumar"; gamer tags are 3 to 24 letters, digits or underscores.
async function freeGamerTag(name) {
  const base = String(name || '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 18) || 'Player'
  const taken = (tag) => database.prepare('SELECT 1 FROM users WHERE lower(display_name) = ?').get(tag.toLowerCase())
  if (base.length >= 3 && !await taken(base)) return base
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const tag = `${base}${crypto.randomInt(100, 1000000)}`
    if (!await taken(tag)) return tag
  }
  return `${base}${Date.now().toString(36)}`
}

// Logs in, or signs up, the owner of a verified Google email. A new account, or one that only a
// browser re-sync created, gets a random password nobody knows; "Forgot password" sets a real one.
async function loginWithGoogle({ credential } = {}, now = Date.now()) {
  const google = await verifyGoogleCredential(credential, process.env.GOOGLE_CLIENT_ID, now)
  return await transaction(async () => {
    let user = await findUserByEmail(google.email, { provenOnly: true })
    const secret = crypto.randomBytes(32).toString('hex')
    if (!user) {
      await database.prepare(`
        INSERT INTO users (user_key, display_name, email, password, login_secret, status, last_active_at, contact_verified, email_verified)
        VALUES (?, ?, ?, ?, ?, 'active', ?, 1, 1)
      `).run(google.email, await freeGamerTag(google.name), google.email, await hashUserPassword(crypto.randomBytes(32).toString('hex')), secret, now)
      return { user: publicUser(await findUserByEmail(google.email)), loginSecret: secret, created: true }
    }
    if (user.status === 'inactive') throw httpError(403, DEACTIVATED_MESSAGE)
    if (!user.contact_verified || !user.login_secret) {
      const password = user.contact_verified ? null : await hashUserPassword(crypto.randomBytes(32).toString('hex'))
      await database.prepare('UPDATE users SET login_secret = ?, password = COALESCE(?, password), contact_verified = 1, last_active_at = ? WHERE user_key = ?')
        .run(secret, password, now, user.user_key)
      user = await findUserByEmail(google.email)
    } else {
      await database.prepare('UPDATE users SET last_active_at = ? WHERE user_key = ?').run(now, user.user_key)
    }
    return { user: publicUser(user), loginSecret: user.login_secret, created: false }
  })
}

// Returns what another account already uses: its email, mobile number or gamer tag.
// provenEmailsOnly ignores emails typed into another profile and never proven, for someone who just
// proved owning the email with a code.
async function findContactConflict({ userKey, email = '', phone = '', displayName = '' }, { provenEmailsOnly = false } = {}) {
  const cleanEmail = normalizeKey(email)
  if (cleanEmail && await database.prepare('SELECT 1 FROM users WHERE user_key <> ? AND ((lower(email) = ? AND (? = 0 OR email_verified = 1)) OR user_key = ?)').get(userKey, cleanEmail, provenEmailsOnly ? 1 : 0, cleanEmail)) {
    return 'That email is already used by another account.'
  }
  const tail = phoneTail(phone)
  if (tail) {
    const others = await database.prepare(`
      SELECT phone, user_key FROM users WHERE user_key <> ?
        AND (replace(replace(phone, ' ', ''), '-', '') LIKE '%' || ? OR replace(replace(user_key, ' ', ''), '-', '') LIKE '%' || ?)
    `).all(userKey, tail, tail)
    if (others.some((user) => phoneTail(user.phone) === tail || phoneTail(user.user_key) === tail)) return 'That mobile number is already used by another account.'
  }
  const cleanName = normalizeKey(displayName)
  if (cleanName && await database.prepare('SELECT 1 FROM users WHERE user_key <> ? AND lower(display_name) = ?').get(userKey, cleanName)) {
    return 'That gamer tag is taken. Try another one.'
  }
  return ''
}

// Players edit their gamer tag, email and mobile number here. The user key never changes, so the
// wallet and match entries stay with the account; login works with the new email or number.
async function updateUserProfile({ userKey, password, displayName, email = '', phone = '' }) {
  const normalizedUser = await authorizeUser(userKey, password)
  if (!await getUserRow(normalizedUser)) throw httpError(404, 'Account not found. Please log in again.')
  const cleanName = String(displayName || '').trim()
  const cleanEmail = String(email || '').trim().toLowerCase()
  const cleanPhone = String(phone || '').trim()
  if (cleanName.length < 3 || cleanName.length > 24) throw new Error('Choose a gamer tag with 3 to 24 characters.')
  if (cleanEmail && !/^\S+@\S+\.\S+$/.test(cleanEmail)) throw new Error('Enter a valid email address.')
  if (cleanPhone && !/^\+?[0-9\s-]{10,15}$/.test(cleanPhone)) throw new Error('Enter a valid mobile number.')
  if (!cleanEmail && !cleanPhone) throw new Error('Keep an email or a mobile number so you can log in.')
  const conflict = await findContactConflict({ userKey: normalizedUser, email: cleanEmail, phone: cleanPhone, displayName: cleanName })
  if (conflict) throw httpError(409, conflict)
  // A new email is unproven until a reset code or Google sign-in shows the player owns it.
  await database.prepare(`
    UPDATE users SET display_name = ?, email = ?, phone = ?, last_active_at = ?,
      email_verified = CASE WHEN lower(email) = ? THEN email_verified ELSE 0 END
    WHERE user_key = ?
  `).run(cleanName, cleanEmail, cleanPhone, Date.now(), cleanEmail, normalizedUser)
  const user = await getUserRow(normalizedUser)
  return { userKey: user.user_key, name: user.display_name, email: user.email, phone: user.phone }
}

async function syncUsers(usersList) {
  if (!Array.isArray(usersList)) return []
  const results = []
  for (const user of usersList) {
    if (!user) continue
    const userKey = user.userKey || user.email || user.phone || user.name
    if (!userKey) continue
    // Existing accounts are left alone: a browser's copy may be older than a profile edit made elsewhere,
    // and this request needs no login, so it must never set the password of an account it did not create.
    if (await database.prepare('SELECT 1 FROM users WHERE user_key = ?').get(normalizeKey(userKey))) continue
    try {
      results.push(await registerOrUpdateUser({
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

async function adminSetUserStatus({ userKey, status }) {
  const normalizedUser = normalizeKey(userKey)
  if (!normalizedUser) throw new Error('User key is required.')
  const cleanStatus = status === 'inactive' ? 'inactive' : 'active'
  const { changes } = await database.prepare('UPDATE users SET status = ? WHERE user_key = ?').run(cleanStatus, normalizedUser)
  if (!changes) throw httpError(404, 'User not found.')
  return await getUserRow(normalizedUser)
}

async function getAdminOverview() {
  await ensureScheduledMatches()
  const now = Date.now()
  const cutoff = now - 60000

  // Purge expired sessions
  await database.prepare('DELETE FROM active_sessions WHERE last_seen < ?').run(cutoff)
  const activeSessions = await database.prepare('SELECT DISTINCT user_key FROM active_sessions WHERE last_seen >= ?').all(cutoff)
  const onlineUserSet = new Set(activeSessions.map((s) => s.user_key).filter(Boolean))

  const users = (await database.prepare(`SELECT ${userColumns} FROM users ORDER BY created_at DESC`).all()).map((u) => ({
    ...u,
    status: u.status || 'active',
    is_online: onlineUserSet.has(u.user_key) || (u.last_active_at && (now - Number(u.last_active_at) < 60000)) ? 1 : 0,
  }))

  const stats = await getLiveStats()

  return {
    users,
    activeUsersCount: stats.activeUsersCount,
    onlineUsersCount: stats.onlineUsersCount,
    liveCount: stats.liveCount,
    matches: await database.prepare(`SELECT match_id, public_id, mode, description, entry_fee, team_count, match_timestamp, prize_pool, status, winner_team_key, confirmed_at, room_id, room_password FROM matches ORDER BY match_id DESC`).all(),
    entries: (await database.prepare(`SELECT match_id, team_key, user_key, identifiers FROM match_entries ORDER BY match_id DESC, team_key, user_key`).all())
      .map((entry) => ({ ...entry, identifiers: parseIdentifiers(entry.identifiers) })),
    payments: await database.prepare(`SELECT id, user_key, amount, coins, utr, status, created_at, reviewed_at, review_note, EXISTS (SELECT 1 FROM uploads u WHERE u.kind = 'payment' AND u.reference_id = payment_requests.id) AS has_screenshot FROM payment_requests ORDER BY id DESC`).all(),
    withdrawals: await database.prepare(`SELECT id, user_key, amount, method, details, status, created_at, reviewed_at, review_note, EXISTS (SELECT 1 FROM uploads u WHERE u.kind = 'withdrawal' AND u.reference_id = withdrawal_requests.id) AS has_screenshot FROM withdrawal_requests ORDER BY id DESC`).all(),
    kills: await database.prepare(`SELECT id, match_id, user_key, kills, created_at FROM match_kills ORDER BY id DESC`).all(),
    ...(await getAdminNotifications()),
  }
}

async function getAdminNotifications({ limit = 40 } = {}) {
  return {
    notifications: await database.prepare('SELECT id, type, user_key, reference_id, title, body, read_at, created_at FROM admin_notifications ORDER BY id DESC LIMIT ?').all(limit),
    unreadNotifications: Number((await database.prepare('SELECT COUNT(*) AS count FROM admin_notifications WHERE read_at IS NULL').get()).count),
  }
}

async function markAdminNotificationsRead({ ids } = {}) {
  if (Array.isArray(ids) && ids.length) {
    const statement = database.prepare('UPDATE admin_notifications SET read_at = CURRENT_TIMESTAMP WHERE id = ? AND read_at IS NULL')
    for (const id of ids) await statement.run(Number(id))
  } else {
    await database.prepare('UPDATE admin_notifications SET read_at = CURRENT_TIMESTAMP WHERE read_at IS NULL').run()
  }
  return await getAdminNotifications()
}

// Looks a user up by key first, then by email, phone or gamer tag.
async function findUser(query) {
  const value = normalizeKey(query)
  if (!value) throw new Error('Enter a user key, email, phone or gamer tag.')
  return await getUserRow(value) || await database.prepare(`
    SELECT ${userColumns} FROM users
    WHERE lower(email) = ? OR replace(phone, ' ', '') = replace(?, ' ', '') OR lower(display_name) = ?
    ORDER BY last_active_at DESC LIMIT 1
  `).get(value, value, value)
}

async function getAdminUserDetail(query) {
  const user = await findUser(query)
  if (!user) throw httpError(404, `No user found for "${String(query).trim()}".`)
  const key = user.user_key
  const lastSeen = await database.prepare('SELECT MAX(last_seen) AS last_seen FROM active_sessions WHERE user_key = ?').get(key)?.last_seen
  const payments = await database.prepare("SELECT id, amount, coins, utr, status, created_at, reviewed_at, review_note, EXISTS (SELECT 1 FROM uploads u WHERE u.kind = 'payment' AND u.reference_id = payment_requests.id) AS has_screenshot FROM payment_requests WHERE user_key = ? ORDER BY id DESC").all(key)
  const withdrawals = await database.prepare("SELECT id, amount, method, details, status, created_at, reviewed_at, review_note, EXISTS (SELECT 1 FROM uploads u WHERE u.kind = 'withdrawal' AND u.reference_id = withdrawal_requests.id) AS has_screenshot FROM withdrawal_requests WHERE user_key = ? ORDER BY id DESC").all(key)
  const payouts = await database.prepare('SELECT match_id, amount, created_at FROM payouts WHERE user_key = ? ORDER BY created_at DESC').all(key)
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
    entries: await database.prepare(`
      SELECT e.match_id, e.team_key, m.public_id, m.mode, m.entry_fee, m.match_timestamp, m.status, m.winner_team_key
      FROM match_entries e LEFT JOIN matches m ON m.match_id = e.match_id
      WHERE e.user_key = ? ORDER BY m.match_timestamp DESC
    `).all(key),
    transactions: await database.prepare('SELECT id, wallet, amount, balance_after, reason, reference, note, created_at FROM wallet_transactions WHERE user_key = ? ORDER BY id DESC LIMIT 100').all(key),
  }
}

async function adjustUserBalance({ userKey, amount, wallet = 'credit', note = '', displayName = '' }) {
  const normalizedUser = normalizeKey(userKey)
  const coins = Number(amount)
  if (!normalizedUser || !Number.isInteger(coins) || coins === 0) throw new Error('User and a non-zero whole coin amount are required.')
  await transaction(async () => {
    await applyWalletChange({ userKey: normalizedUser, wallet, amount: coins, reason: coins > 0 ? 'admin_add' : 'admin_deduct', note: String(note).trim() })
    const cleanName = String(displayName || '').trim()
    if (cleanName) await database.prepare('UPDATE users SET display_name = ? WHERE user_key = ?').run(cleanName, normalizedUser)
  })
  return await getUserRow(normalizedUser)
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
async function getUserEntries(userKey, now = Date.now()) {
  return (await database.prepare(`
    SELECT e.match_id, e.team_key, e.identifiers, m.public_id, m.mode, m.entry_fee, m.match_timestamp, m.status, m.winner_team_key, m.room_id, m.room_password
    FROM match_entries e JOIN matches m ON m.match_id = e.match_id
    WHERE e.user_key = ? ORDER BY m.match_timestamp DESC LIMIT 50
  `).all(userKey)).map((entry) => {
    const startsAt = Number(entry.match_timestamp) || 0
    const showRoom = entry.status === 'open' && Boolean(entry.room_id) && (!startsAt || now >= startsAt - ROOM_REVEAL_MS)
    return {
      matchId: entry.match_id,
      publicId: entry.public_id,
      mode: entry.mode,
      entryFee: entry.entry_fee,
      matchTimestamp: startsAt,
      status: entry.status,
      won: entry.status === 'confirmed' && entry.winner_team_key === entry.team_key,
      identifiers: parseIdentifiers(entry.identifiers),
      roomId: showRoom ? entry.room_id : '',
      roomPassword: showRoom ? entry.room_password : '',
    }
  })
}

async function getUserWallet(userKey, now = Date.now()) {
  const user = await getUserRow(userKey)
  const creditCoins = Number(user?.credit_coins || 0)
  const winningCoins = Number(user?.winning_coins || 0)
  return {
    userKey,
    creditCoins,
    winningCoins,
    totalCoins: creditCoins + winningCoins,
    profile: user ? { name: user.display_name, email: user.email, phone: user.phone } : null,
    payments: await database.prepare('SELECT id, amount, coins, utr, status, created_at, reviewed_at, review_note FROM payment_requests WHERE user_key = ? ORDER BY id DESC LIMIT 10').all(userKey),
    withdrawals: await database.prepare('SELECT id, amount, method, status, created_at, reviewed_at, review_note FROM withdrawal_requests WHERE user_key = ? ORDER BY id DESC LIMIT 10').all(userKey),
    entries: await getUserEntries(userKey, now),
  }
}

async function getAuthorizedWallet({ userKey, password }, now = Date.now()) {
  return await getUserWallet(await authorizeUser(userKey, password), now)
}

// Screenshots arrive as data URLs; the browser shrinks them first. Only real PNG, JPEG or WebP
// files are kept, checked by their first bytes rather than the type the browser claims.
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024
const imageSignatures = { 'image/png': (bytes) => bytes.subarray(0, 4).toString('hex') === '89504e47', 'image/jpeg': (bytes) => bytes.subarray(0, 3).toString('hex') === 'ffd8ff', 'image/webp': (bytes) => bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP' }

function readImage(dataUrl, label) {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''))
  if (!match) throw new Error(`Attach the ${label} as a PNG, JPG or WebP image.`)
  const bytes = Buffer.from(match[2], 'base64')
  if (!bytes.length || bytes.length > MAX_UPLOAD_BYTES) throw new Error(`The ${label} must be smaller than 2 MB.`)
  if (!imageSignatures[match[1]](bytes)) throw new Error(`The ${label} is not a valid image.`)
  return { mime: match[1], data: match[2] }
}

async function saveUpload(kind, referenceId, userKey, image) {
  await database.prepare('INSERT INTO uploads (kind, reference_id, user_key, mime, data) VALUES (?, ?, ?, ?, ?)').run(kind, referenceId, userKey, image.mime, image.data)
}

// The Admin Desk loads one screenshot at a time, so the overview never carries image data.
async function getUpload({ kind, id }) {
  const upload = await database.prepare('SELECT mime, data, created_at FROM uploads WHERE kind = ? AND reference_id = ? ORDER BY id DESC LIMIT 1').get(String(kind), Number(id))
  if (!upload) throw httpError(404, 'No screenshot was uploaded for this request.')
  return { dataUrl: `data:${upload.mime};base64,${upload.data}`, uploadedAt: upload.created_at }
}

async function recordPaymentRequest({ userKey, password, amount, utr = '', screenshot }) {
  const normalizedUser = await authorizeUser(userKey, password)
  const image = screenshot ? readImage(screenshot, 'payment screenshot') : null
  const coins = Number(amount)
  if (!Number.isInteger(coins) || coins < 50) throw new Error('Top-ups must be at least 50 whole coins.')
  const cleanUtr = String(utr).trim().toUpperCase()
  if (!/^[A-Z0-9]{6,35}$/.test(cleanUtr)) throw new Error('Enter the UTR / transaction ID exactly as shown in your UPI app (letters and numbers only).')
  const now = Date.now()
  return await transaction(async () => {
    // Checked inside the transaction, so two submissions of one UTR arriving together cannot both pass.
    const duplicate = await database.prepare("SELECT user_key FROM payment_requests WHERE utr = ? AND status <> 'rejected'").get(cleanUtr)
    if (duplicate) throw httpError(409, 'This UTR has already been submitted. Each payment can only be claimed once.')
    await database.prepare('UPDATE users SET last_active_at = ? WHERE user_key = ?').run(now, normalizedUser)
    const { lastInsertRowid } = await database.prepare('INSERT INTO payment_requests (user_key, amount, coins, utr) VALUES (?, ?, ?, ?)').run(normalizedUser, coins, coins, cleanUtr)
    const id = Number(lastInsertRowid)
    if (image) await saveUpload('payment', id, normalizedUser, image)
    await addAdminNotification({ type: 'payment', userKey: normalizedUser, referenceId: id, title: `Coin top-up: ${coins} coins`, body: `${normalizedUser} paid ₹${coins} · UTR ${cleanUtr}` })
    return await database.prepare('SELECT id, user_key, amount, coins, utr, status, created_at FROM payment_requests WHERE id = ?').get(id)
  })
}

async function reviewPaymentRequest({ id, decision, note = '' }) {
  const requestId = Number(id)
  if (!Number.isInteger(requestId) || !['approve', 'reject'].includes(decision)) throw new Error('A payment id and a decision of approve or reject are required.')
  return await transaction(async () => {
    const payment = await database.prepare('SELECT * FROM payment_requests WHERE id = ?').get(requestId)
    if (!payment) throw httpError(404, 'Payment request not found.')
    if (payment.status !== 'pending') throw httpError(409, `This payment was already ${payment.status}.`)
    const status = decision === 'approve' ? 'approved' : 'rejected'
    // Older data may hold the same UTR twice; it still pays out only once.
    if (status === 'approved' && await database.prepare("SELECT 1 FROM payment_requests WHERE utr = ? AND status = 'approved' AND id <> ?").get(payment.utr, requestId)) {
      throw httpError(409, `UTR ${payment.utr} was already approved on another top-up. Reject this one.`)
    }
    await database.prepare('UPDATE payment_requests SET status = ?, reviewed_at = CURRENT_TIMESTAMP, review_note = ? WHERE id = ?').run(status, String(note).trim(), requestId)
    if (status === 'approved') {
      await applyWalletChange({ userKey: payment.user_key, wallet: 'credit', amount: payment.coins, reason: 'topup_approved', reference: `payment:${requestId}`, note: `UTR ${payment.utr}` })
    }
    await markReferenceNotificationsRead('payment', requestId)
    return { payment: await database.prepare('SELECT id, user_key, amount, coins, utr, status, created_at, reviewed_at, review_note FROM payment_requests WHERE id = ?').get(requestId), user: await getUserRow(payment.user_key) }
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
async function recordMatchEntry({ matchId, identifiers, userKey, password }, now = Date.now()) {
  const normalizedUser = await authorizeUser(userKey, password)
  const normalizedMatch = normalizeKey(matchId)
  if (!normalizedMatch) throw new Error('Invalid match entry.')
  await ensureScheduledMatches(now)
  return await transaction(async () => {
    const match = await database.prepare('SELECT match_id, public_id, mode, entry_fee, match_timestamp, status FROM matches WHERE match_id = ?').get(normalizedMatch)
    if (!match) throw httpError(404, 'This match is no longer available. Pick another match.')
    const names = cleanIdentifiers(identifiers, match.mode)
    const startsAt = Number(match.match_timestamp) || 0
    await database.prepare('UPDATE users SET last_active_at = ? WHERE user_key = ?').run(now, normalizedUser)

    const existing = await database.prepare('SELECT identifiers FROM match_entries WHERE match_id = ? AND user_key = ?').get(match.match_id, normalizedUser)
    if (existing) {
      if (names.length && JSON.stringify(names) !== JSON.stringify(parseIdentifiers(existing.identifiers))) {
        if (startsAt && now >= startsAt - EDIT_LOCK_MS) throw httpError(409, 'Player names are locked 1 hour before the match starts.')
        await database.prepare('UPDATE match_entries SET identifiers = ? WHERE match_id = ? AND user_key = ?').run(JSON.stringify(names), match.match_id, normalizedUser)
      }
      return { charged: 0, wallet: await getUserWallet(normalizedUser, now) }
    }
    if (match.status === 'confirmed') throw httpError(409, 'This match has already finished.')
    if (startsAt && now >= startsAt) throw httpError(409, 'This match has already started, so joining is closed. Pick an upcoming match.')
    if (await joinedTeamCount(match.match_id) >= getMatchCapacity(match.mode).total) throw httpError(409, 'This match is full. Pick another match.')

    // Credit coins are spent first.
    const user = await getUserRow(normalizedUser)
    const fromCredit = Math.min(user.credit_coins, match.entry_fee)
    const fromWinning = match.entry_fee - fromCredit
    if (fromWinning > user.winning_coins) throw httpError(402, `You need ${fromWinning - user.winning_coins} more coins to join this match.`)
    const note = `Joined match #${match.public_id || match.match_id}`
    if (fromCredit) await applyWalletChange({ userKey: normalizedUser, wallet: 'credit', amount: -fromCredit, reason: 'match_entry', reference: match.match_id, note })
    if (fromWinning) await applyWalletChange({ userKey: normalizedUser, wallet: 'winning', amount: -fromWinning, reason: 'match_entry', reference: match.match_id, note })
    await database.prepare('INSERT INTO match_entries (match_id, team_key, user_key, identifiers) VALUES (?, ?, ?, ?)').run(match.match_id, normalizedUser, normalizedUser, JSON.stringify(names))
    return { charged: match.entry_fee, wallet: await getUserWallet(normalizedUser, now) }
  })
}

async function registerMatchCatalog(matches) {
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
    await statement.run(matchId, publicId, String(match.mode || ''), fee, Number(match.matchTimestamp) || null, matchId, publicId)
  }
}

// Matches from the last day onwards, with how many teams joined each so every player sees the same count.
async function getPublicMatchCatalog(now = Date.now()) {
  await ensureScheduledMatches(now)
  return await database.prepare(`
    SELECT m.match_id, m.public_id, m.mode, m.description, m.entry_fee, m.match_timestamp, m.prize_pool, m.status,
      (SELECT COUNT(DISTINCT e.team_key) FROM match_entries e WHERE e.match_id = m.match_id) AS joined_count
    FROM matches m
    WHERE m.mode <> '' AND m.match_timestamp >= ?
    ORDER BY m.match_timestamp, m.match_id
  `).all(now - 24 * 60 * 60 * 1000)
}

// Winning coins are held as soon as a withdrawal is requested; rejecting the request refunds them.
// Only the fields the admin needs to send the money are kept, so the request shows exactly who gets paid.
function cleanPayoutDetails(method, details = {}) {
  const text = (value) => String(value ?? '').trim()
  if (method === 'upi') {
    const upiId = text(details.upiId)
    const upiName = text(details.upiName)
    if (!/^[\w.-]+@[\w.-]+$/.test(upiId)) throw new Error('Enter a valid UPI ID, for example player@upi.')
    if (upiName.length < 2 || upiName.length > 60) throw new Error('Enter the name on your UPI account.')
    return { upiId, upiName }
  }
  const accountName = text(details.accountName)
  const accountNumber = text(details.accountNumber)
  const ifsc = text(details.ifsc).toUpperCase()
  if (accountName.length < 2 || !/^\d{9,18}$/.test(accountNumber) || !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) {
    throw new Error('Enter a valid account name, account number and IFSC code.')
  }
  return { accountName, accountNumber, ifsc }
}

async function recordWithdrawalRequest({ userKey, password, amount, method, details = {}, qrScreenshot }) {
  const normalizedUser = await authorizeUser(userKey, password)
  const coins = Number(amount)
  if (!Number.isInteger(coins) || coins < 50 || !['upi', 'bank'].includes(method)) throw new Error('Invalid withdrawal request.')
  const payTo = cleanPayoutDetails(method, details)
  const image = qrScreenshot ? readImage(qrScreenshot, 'UPI QR screenshot') : null
  return await transaction(async () => {
    const { lastInsertRowid } = await database.prepare('INSERT INTO withdrawal_requests (user_key, amount, method, details) VALUES (?, ?, ?, ?)').run(normalizedUser, coins, method, JSON.stringify(payTo))
    const id = Number(lastInsertRowid)
    if (image) await saveUpload('withdrawal', id, normalizedUser, image)
    await applyWalletChange({ userKey: normalizedUser, wallet: 'winning', amount: -coins, reason: 'withdrawal_hold', reference: `withdrawal:${id}`, note: `${method.toUpperCase()} withdrawal requested` })
    await addAdminNotification({ type: 'withdrawal', userKey: normalizedUser, referenceId: id, title: `Withdrawal: ${coins} coins`, body: `${normalizedUser} requested ${coins} coins via ${method.toUpperCase()}` })
    return { id, wallet: await getUserWallet(normalizedUser) }
  })
}

async function reviewWithdrawalRequest({ id, decision, note = '' }) {
  const requestId = Number(id)
  if (!Number.isInteger(requestId) || !['approve', 'reject'].includes(decision)) throw new Error('A withdrawal id and a decision of approve or reject are required.')
  return await transaction(async () => {
    const withdrawal = await database.prepare('SELECT * FROM withdrawal_requests WHERE id = ?').get(requestId)
    if (!withdrawal) throw httpError(404, 'Withdrawal request not found.')
    if (withdrawal.status !== 'pending') throw httpError(409, `This withdrawal was already ${withdrawal.status}.`)
    const status = decision === 'approve' ? 'approved' : 'rejected'
    await database.prepare('UPDATE withdrawal_requests SET status = ?, reviewed_at = CURRENT_TIMESTAMP, review_note = ? WHERE id = ?').run(status, String(note).trim(), requestId)
    // Only refund what this request actually held; older requests were never held on the server.
    const held = -Number((await database.prepare("SELECT COALESCE(SUM(amount), 0) AS held FROM wallet_transactions WHERE reference = ? AND reason = 'withdrawal_hold'").get(`withdrawal:${requestId}`)).held)
    if (status === 'rejected' && held > 0) {
      await applyWalletChange({ userKey: withdrawal.user_key, wallet: 'winning', amount: held, reason: 'withdrawal_refund', reference: `withdrawal:${requestId}`, note: String(note).trim() || 'Withdrawal rejected' })
    }
    await markReferenceNotificationsRead('withdrawal', requestId)
    return { withdrawal: await database.prepare('SELECT id, user_key, amount, method, details, status, created_at, reviewed_at, review_note FROM withdrawal_requests WHERE id = ?').get(requestId), user: await getUserRow(withdrawal.user_key) }
  })
}

// The admin types a public id such as #000001; kills are stored under the match's internal id,
// which is what Match control and deleting a match look them up by.
async function recordMatchKills({ matchId, kills }) {
  if (!String(matchId || '').trim() || !Array.isArray(kills)) throw new Error('Match and kills are required.')
  const match = await findMatch(matchId)
  if (!match) throw httpError(404, 'Match not found. Enter its public ID, such as #000001.')
  const records = kills.map((entry) => ({ userKey: normalizeKey(entry.userKey), count: Number(entry.kills) }))
  for (const { userKey, count } of records) {
    if (!userKey || !Number.isInteger(count) || count < 0) throw new Error('Invalid kill record.')
    if (!await database.prepare('SELECT 1 FROM match_entries WHERE match_id = ? AND user_key = ?').get(match.match_id, userKey)) {
      throw httpError(404, `${userKey} did not join match #${match.public_id || match.match_id}.`)
    }
  }
  const statement = database.prepare(`
    INSERT INTO match_kills (match_id, user_key, kills) VALUES (?, ?, ?)
    ON CONFLICT(match_id, user_key) DO UPDATE SET kills = excluded.kills
  `)
  for (const { userKey, count } of records) await statement.run(match.match_id, userKey, count)
}

async function joinedTeamCount(matchId) {
  return Number((await database.prepare('SELECT COUNT(DISTINCT team_key) AS teams FROM match_entries WHERE match_id = ?').get(matchId)).teams)
}

// Player-joined matches all store team_count 2, so the prize pool counts the teams that actually joined.
async function countJoinedTeams(match) {
  return await joinedTeamCount(match.match_id) || match.team_count
}

async function getPayoutSummary(matchId) {
  const match = await findMatch(matchId)
  const payouts = await database.prepare('SELECT user_key, amount FROM payouts WHERE match_id = ? ORDER BY user_key').all(match.match_id)
  const totalPool = match.entry_fee * await countJoinedTeams(match)
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
  registerVerifiedUser,
  requestSignupOtp,
  requestPasswordResetOtp,
  resetPassword,
  loginWithGoogle,
  syncUsers,
  adminSetUserStatus,
  getAdminNotifications,
  markAdminNotificationsRead,
  getAdminUserDetail,
  getAuthorizedWallet,
  reviewPaymentRequest,
  reviewWithdrawalRequest,
  getUpload,
}
