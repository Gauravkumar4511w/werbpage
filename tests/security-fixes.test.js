/* global process */
import './isolate-env.js'
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'arenacore-security-test-'))
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

const hour = 60 * 60 * 1000
let admin
const login = (loginValue, password) => request('/api/users/login', { body: { login: loginValue, password } })

async function makePlayer(email, displayName, password = 'player-pass') {
  const result = await signUp(request, { email, displayName, password })
  assert.equal(result.status, 200, JSON.stringify(result.data))
  return { userKey: email, password: result.data.loginSecret }
}

before(async () => {
  const result = await request('/api/admin/login', { body: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD } })
  admin = { authorization: `Bearer ${result.data.token}` }
})

test('requests that need no login cannot reserve or take over someone else\'s email', async () => {
  const victim = 'victim@test.com'
  await request('/api/presence/heartbeat', { body: { sessionId: 'attacker', userKey: victim } })
  await request('/api/users/sync', { body: { users: [{ userKey: victim, email: victim, name: 'Attacker', password: 'attacker-pass' }] } })

  // The real owner can still sign up, and the attacker's password no longer opens the account.
  const owner = await signUp(request, { email: victim, displayName: 'RealVictim', password: 'victim-pass' })
  assert.equal(owner.status, 200, JSON.stringify(owner.data))
  assert.equal((await login(victim, 'attacker-pass')).status, 401)
  assert.equal((await login(victim, 'victim-pass')).status, 200)

  // A heartbeat for an unknown key creates no account at all.
  await request('/api/presence/heartbeat', { body: { sessionId: 'ghost', userKey: 'ghost@test.com' } })
  const detail = await request('/api/admin/users/detail', { method: 'GET', headers: admin, query: { userKey: 'ghost@test.com' } })
  assert.equal(detail.status, 404)

  // A re-sync never sets the password of an account it did not create.
  await request('/api/users/sync', { body: { users: [{ userKey: victim, email: victim, password: 'second-try' }] } })
  assert.equal((await login(victim, 'second-try')).status, 401)
})

test('accounts without a password cannot be used until their owner sets one', async () => {
  const created = await request('/api/admin/users/create', { headers: admin, body: { userKey: 'no-pass@test.com', displayName: 'NoPass', creditCoins: 300 } })
  assert.equal(created.status, 201)
  for (const password of ['', 'anything']) {
    assert.equal((await request('/api/users/wallet', { body: { userKey: 'no-pass@test.com', password } })).status, 403)
  }
  assert.equal((await request('/api/users/wallet', { body: { userKey: 'never-registered@test.com', password: '' } })).status, 403)

  // Its owner proves the email with a code and gets the coins the admin added.
  const owner = await signUp(request, { email: 'no-pass@test.com', displayName: 'NoPassOwner', password: 'owner-pass' })
  assert.equal(owner.status, 200, JSON.stringify(owner.data))
  const wallet = await request('/api/users/wallet', { body: { userKey: 'no-pass@test.com', password: owner.data.loginSecret } })
  assert.equal(wallet.data.creditCoins, 300)
})

test('a player the admin adds with a password can log in with it', async () => {
  const created = await request('/api/admin/users/create', { headers: admin, body: { userKey: '+91 98765 00001', displayName: 'PhonePlayer', password: 'phone-pass', creditCoins: 100 } })
  assert.equal(created.status, 201, JSON.stringify(created.data))
  const result = await login('9876500001', 'phone-pass')
  assert.equal(result.status, 200, JSON.stringify(result.data))
  const wallet = await request('/api/users/wallet', { body: { userKey: '+91 98765 00001', password: result.data.loginSecret } })
  assert.equal(wallet.data.creditCoins, 100)
  assert.equal((await request('/api/admin/users/create', { headers: admin, body: { userKey: 'short@test.com', displayName: 'Short', password: '123' } })).status, 400)
})

test('wrong codes sent all at once still lock the code after five tries', async () => {
  const details = { email: 'parallel@test.com', displayName: 'ParallelGuess', password: 'secret123' }
  const sent = await db.requestSignupOtp(details)
  const wrong = sent.devOtp === '000000' ? '111111' : '000000'
  const guesses = await Promise.allSettled(Array.from({ length: 20 }, () => db.registerVerifiedUser({ ...details, otpToken: sent.otpToken, otp: wrong })))
  assert.equal(guesses.filter((guess) => /Wrong code/.test(guess.reason?.message)).length, 4)
  // The right code is refused now too.
  await assert.rejects(() => db.registerVerifiedUser({ ...details, otpToken: sent.otpToken, otp: sent.devOtp }), /Too many wrong codes/)
})

test('asking for sign-up codes does not use up password-reset codes', async () => {
  // A mobile account resets its password through the email saved in its profile. That email has no
  // account of its own, so anyone may ask for sign-up codes to it.
  await db.registerOrUpdateUser({ userKey: '+91 98765 00009', phone: '+91 98765 00009', displayName: 'LimitsPlayer', password: 'limits-pass' }, { trusted: true })
  const signedIn = await login('9876500009', 'limits-pass')
  await request('/api/users/profile', { body: { userKey: '+91 98765 00009', password: signedIn.data.loginSecret, displayName: 'LimitsPlayer', email: 'limits@test.com', phone: '+91 98765 00009' } })

  const start = Date.now() + hour
  for (let index = 0; index < 5; index += 1) {
    await db.requestSignupOtp({ email: 'limits@test.com', displayName: 'LimitsSpam' }, start + index * 60 * 1000)
  }
  await assert.rejects(() => db.requestSignupOtp({ email: 'limits@test.com', displayName: 'LimitsSpam' }, start + 6 * 60 * 1000), /Too many codes/)
  // The account's owner can still get a reset code.
  assert.ok((await db.requestPasswordResetOtp({ email: 'limits@test.com' }, start + 7 * 60 * 1000)).otpToken)
})

test('one UTR submitted twice at the same moment is accepted only once', async () => {
  const player = await makePlayer('utr-race@test.com', 'UtrRacer')
  const results = await Promise.all([1, 2].map(() => request('/api/payments/request', { body: { ...player, amount: 100, utr: 'RACE12345678' } })))
  assert.deepEqual(results.map((result) => result.status).sort(), [201, 409])
})

test('kills recorded with a public match id show up for that match', async () => {
  const player = await makePlayer('killer@test.com', 'KillerOne')
  await db.adjustUserBalance({ userKey: player.userKey, amount: 500 })
  const match = (await request('/api/admin/matches/create', { headers: admin, body: { mode: 'Clash Squad 1v1', entryFee: 50, matchTimestamp: Date.now() + 3 * hour } })).data.match
  assert.equal((await request('/api/matches/entry', { body: { ...player, matchId: match.match_id, identifiers: ['KillerIGN'] } })).status, 201)

  const saved = await request('/api/admin/matches/kills', { headers: admin, body: { matchId: `#${match.public_id}`, kills: [{ userKey: player.userKey, kills: 7 }] } })
  assert.equal(saved.status, 200, JSON.stringify(saved.data))
  const overview = await request('/api/admin/overview', { method: 'GET', headers: admin })
  assert.ok(overview.data.kills.some((row) => row.match_id === match.match_id && row.user_key === player.userKey && row.kills === 7))

  assert.equal((await request('/api/admin/matches/kills', { headers: admin, body: { matchId: '#999999', kills: [{ userKey: player.userKey, kills: 1 }] } })).status, 400)
  assert.equal((await request('/api/admin/matches/kills', { headers: admin, body: { matchId: match.public_id, kills: [{ userKey: 'outsider@test.com', kills: 1 }] } })).status, 400)
})

test('two result confirmations at once pay only one winner', async () => {
  const first = await makePlayer('race-a@test.com', 'RaceA')
  const second = await makePlayer('race-b@test.com', 'RaceB')
  const match = (await request('/api/admin/matches/create', { headers: admin, body: { mode: 'Clash Squad 1v1', entryFee: 50, matchTimestamp: Date.now() + 3 * hour } })).data.match
  for (const player of [first, second]) {
    await db.adjustUserBalance({ userKey: player.userKey, amount: 50 })
    await request('/api/matches/entry', { body: { ...player, matchId: match.match_id, identifiers: ['RacerIGN'] } })
  }
  await Promise.all([first, second].map((player) => request('/api/admin/matches/confirm-result', { headers: admin, body: { matchId: match.match_id, winnerTeamKey: player.userKey } })))
  const winnings = await Promise.all([first, second].map(async (player) => (await request('/api/users/wallet', { body: player })).data.winningCoins))
  assert.deepEqual(winnings.sort((a, b) => a - b), [0, 80])

  // A confirmed match can no longer be deleted (which would refund the fees on top of the payout).
  assert.equal((await request('/api/admin/matches/delete', { method: 'DELETE', headers: admin, body: { matchId: match.match_id } })).status, 400)
})

test('players online counts browsers, not every account ever made', async () => {
  const stats = await request('/api/presence/heartbeat', { body: { sessionId: 'only-visitor-check' } })
  assert.equal(stats.data.liveCount, stats.data.onlineSessionsCount)
})

test('an email taken out of ADMIN_EMAIL can no longer log in', async () => {
  const before = await request('/api/admin/login', { body: { email: 'admin-test@example.com', password: process.env.ADMIN_PASSWORD } })
  assert.equal(before.status, 200)
  process.env.ADMIN_EMAIL = 'new-admin@example.com'
  try {
    assert.equal((await request('/api/admin/login', { body: { email: 'admin-test@example.com', password: process.env.ADMIN_PASSWORD } })).status, 401)
    assert.equal((await request('/api/admin/login', { body: { email: 'new-admin@example.com', password: process.env.ADMIN_PASSWORD } })).status, 200)
    assert.equal((await request('/api/admin/login', { body: { email: 'admin', password: process.env.ADMIN_PASSWORD } })).status, 200)
  } finally {
    process.env.ADMIN_EMAIL = 'admin-test@example.com'
  }
})

test('the admin user page lists every joined match with names, kills and payout', async () => {
  const player = await makePlayer('detail-player@test.com', 'DetailPlayer')
  const rival = await makePlayer('detail-rival@test.com', 'DetailRival')
  const create = async (hoursAhead) => (await request('/api/admin/matches/create', { headers: admin, body: { mode: 'Clash Squad 1v1', entryFee: 50, matchTimestamp: Date.now() + hoursAhead * hour } })).data.match
  const played = await create(2)
  const upcoming = await create(5)
  for (const entrant of [player, rival]) await db.adjustUserBalance({ userKey: entrant.userKey, amount: 150 })
  for (const [entrant, match, name] of [[player, played, 'DetailIGN'], [rival, played, 'RivalIGN'], [player, upcoming, 'DetailIGN']]) {
    assert.equal((await request('/api/matches/entry', { body: { ...entrant, matchId: match.match_id, identifiers: [name] } })).status, 201)
  }
  await request('/api/admin/matches/kills', { headers: admin, body: { matchId: played.public_id, kills: [{ userKey: player.userKey, kills: 4 }] } })
  await request('/api/admin/matches/confirm-result', { headers: admin, body: { matchId: played.match_id, winnerTeamKey: player.userKey } })

  const detail = await request('/api/admin/users/detail', { method: 'GET', headers: admin, query: { userKey: player.userKey } })
  assert.equal(detail.status, 200)
  const byId = Object.fromEntries(detail.data.entries.map((entry) => [entry.match_id, entry]))
  assert.equal(detail.data.entries.length, 2)
  assert.deepEqual(byId[played.match_id].identifiers, ['DetailIGN'])
  assert.equal(byId[played.match_id].kills, 4)
  assert.equal(byId[played.match_id].payout, 80)
  assert.equal(byId[played.match_id].winner_team_key, player.userKey)
  assert.equal(byId[upcoming.match_id].status, 'open')
  assert.equal(byId[upcoming.match_id].kills, null)
})
