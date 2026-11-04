/* global process, Buffer */
import './isolate-env.js'
import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import crypto from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'arenacore-otp-test-'))
process.env.DATABASE_DIR = directory
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

const send = (body) => request('/api/auth/otp/send', { body })
const register = (body) => request('/api/users/register', { body })
const login = (loginValue, password) => request('/api/users/login', { body: { login: loginValue, password } })
const forgot = (email) => request('/api/auth/password/forgot', { body: { email } })
const reset = (body) => request('/api/auth/password/reset', { body })
const wrongCodeFor = (otp) => (otp === '000000' ? '111111' : '000000')
// Accounts made directly, so their email has no sign-up code still inside the 30 second resend wait.
const makeAccount = (email, displayName, password) => db.registerOrUpdateUser({ userKey: email, email, displayName, password }, { trusted: true })

test('sending a code checks the details and never puts the code in the token', async () => {
  assert.equal((await send({ email: 'not-an-email', displayName: 'Kite' })).status, 400)
  assert.equal((await send({ email: 'kite@test.com', displayName: 'K' })).status, 400)
  assert.equal((await send({ phone: '98765 43210', displayName: 'Kite' })).status, 400)

  const sent = await send({ email: 'Kite@Test.com', displayName: 'Kite' })
  assert.equal(sent.status, 200, JSON.stringify(sent.data))
  assert.match(sent.data.devOtp, /^\d{6}$/)
  assert.equal(sent.data.sentTo, 'ki**@test.com')
  assert.equal(sent.data.resendAfterMs, 30000)
  assert.ok(!Buffer.from(sent.data.otpToken.split('.')[1], 'base64url').toString().includes(sent.data.devOtp))

  const again = await send({ email: 'kite@test.com', displayName: 'Kite' })
  assert.equal(again.status, 429)
  assert.match(again.data.message, /wait \d+ seconds/)
})

test('an account is created only with the right code for that exact email', async () => {
  const details = { email: 'Shadow@Test.com', displayName: 'ShadowKite', password: 'secret123' }
  const sent = await send(details)
  const otp = sent.data.devOtp

  assert.equal((await register({ ...details, otp })).status, 400)
  assert.equal((await register({ ...details, email: 'other@test.com', otpToken: sent.data.otpToken, otp })).status, 400)
  assert.equal((await register({ ...details, otpToken: `${sent.data.otpToken}x`, otp })).status, 400)
  const wrong = await register({ ...details, otpToken: sent.data.otpToken, otp: wrongCodeFor(otp) })
  assert.equal(wrong.status, 400)
  assert.match(wrong.data.message, /4 tries left/)

  const created = await register({ ...details, otpToken: sent.data.otpToken, otp })
  assert.equal(created.status, 200, JSON.stringify(created.data))
  assert.equal(created.data.user.user_key, 'shadow@test.com')
  assert.equal(created.data.user.email, 'shadow@test.com')

  assert.equal((await login('shadow@test.com', 'secret123')).status, 200)
  const reuse = await register({ ...details, password: 'attacker', otpToken: sent.data.otpToken, otp })
  assert.equal(reuse.status, 409)
})

test('five wrong codes lock the code out', async () => {
  const details = { email: 'guesser@test.com', displayName: 'Guesser', password: 'secret123' }
  const sent = await send(details)
  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.equal((await register({ ...details, otpToken: sent.data.otpToken, otp: wrongCodeFor(sent.data.devOtp) })).status, 400)
  }
  const locked = await register({ ...details, otpToken: sent.data.otpToken, otp: sent.data.devOtp })
  assert.equal(locked.status, 429)
})

test('codes expire after ten minutes', async () => {
  const now = Date.now()
  const details = { email: 'late@test.com', displayName: 'LatePlayer', password: 'secret123' }
  const sent = await db.requestSignupOtp(details, now)
  await assert.rejects(() => db.registerVerifiedUser({ ...details, otpToken: sent.otpToken, otp: sent.devOtp }, now + 10 * 60 * 1000 + 1), /expired/)
  assert.equal((await db.registerVerifiedUser({ ...details, otpToken: sent.otpToken, otp: sent.devOtp }, now + 60 * 1000)).user_key, 'late@test.com')
})

test('taken emails and gamer tags are refused before a code is sent', async () => {
  assert.equal((await signUp(request, { email: 'taken@test.com', displayName: 'TakenTag', password: 'secret123' })).status, 200)
  assert.equal((await send({ email: 'TAKEN@test.com', displayName: 'NewTag' })).status, 409)
  assert.equal((await send({ email: 'fresh@test.com', displayName: 'takentag' })).status, 409)
})

test('a verified sign-up claims an account that only a browser re-sync created', async () => {
  await request('/api/users/sync', { body: { users: [{ userKey: 'claimed@test.com', email: 'claimed@test.com', name: 'Squatter', password: 'squatter-pass' }] } })
  assert.equal((await login('claimed@test.com', 'squatter-pass')).status, 200)

  const claimed = await signUp(request, { email: 'claimed@test.com', displayName: 'RealOwner', password: 'owner-pass' })
  assert.equal(claimed.status, 200, JSON.stringify(claimed.data))
  assert.equal(claimed.data.user.display_name, 'RealOwner')
  assert.equal((await login('claimed@test.com', 'squatter-pass')).status, 401)
  assert.equal((await send({ email: 'claimed@test.com', displayName: 'Another' })).status, 409)
})

test('a forgotten password is reset with a code emailed to the account', async () => {
  await makeAccount('forgetful@test.com', 'Forgetful', 'old-password')
  assert.equal((await forgot('nobody@test.com')).status, 404)
  assert.equal((await forgot('bad-email')).status, 400)

  const sent = await forgot('Forgetful@Test.com')
  assert.equal(sent.status, 200, JSON.stringify(sent.data))
  assert.match(sent.data.devOtp, /^\d{6}$/)
  const details = { email: 'forgetful@test.com', otpToken: sent.data.otpToken, password: 'new-password' }

  assert.equal((await reset({ ...details, otp: wrongCodeFor(sent.data.devOtp) })).status, 400)
  assert.equal((await reset({ ...details, otp: sent.data.devOtp, password: '123' })).status, 400)
  const done = await reset({ ...details, otp: sent.data.devOtp })
  assert.equal(done.status, 200, JSON.stringify(done.data))
  assert.deepEqual(done.data.user, { userKey: 'forgetful@test.com', name: 'Forgetful', email: 'forgetful@test.com', phone: '' })

  assert.equal((await login('forgetful@test.com', 'old-password')).status, 401)
  assert.equal((await login('forgetful@test.com', 'new-password')).status, 200)
  assert.equal((await request('/api/users/wallet', { body: { userKey: 'forgetful@test.com', password: 'old-password' } })).status, 403)
})

test('a sign-up code cannot reset a password, and a reset code cannot sign up', async () => {
  await makeAccount('mixed@test.com', 'MixedUp', 'secret123')
  const signupCode = await send({ email: 'mixed-new@test.com', displayName: 'MixedNew' })
  assert.equal((await reset({ email: 'mixed-new@test.com', otpToken: signupCode.data.otpToken, otp: signupCode.data.devOtp, password: 'hijacked' })).status, 400)

  const resetCode = await forgot('mixed@test.com')
  assert.equal(resetCode.status, 200, JSON.stringify(resetCode.data))
  const signupAttempt = await register({ email: 'mixed@test.com', displayName: 'Mixed2', password: 'x123456', otpToken: resetCode.data.otpToken, otp: resetCode.data.devOtp })
  assert.equal(signupAttempt.status, 400)
})

test('mobile-number accounts with an email can reset by email', async () => {
  await db.registerOrUpdateUser({ userKey: '+91 98888 11111', displayName: 'PhoneUser', phone: '+91 98888 11111', email: 'phone-user@test.com', password: 'old-password' }, { trusted: true })
  const sent = await forgot('phone-user@test.com')
  const done = await reset({ email: 'phone-user@test.com', otpToken: sent.data.otpToken, otp: sent.data.devOtp, password: 'new-password' })
  assert.equal(done.data.user.userKey, '+91 98888 11111')
  assert.equal((await login('9888811111', 'new-password')).status, 200)
})

test('without a provider outside dev mode the code is not shown', async () => {
  process.env.OTP_DEV_MODE = 'false'
  try {
    const sent = await send({ email: 'prod@test.com', displayName: 'ProdPlayer' })
    assert.equal(sent.status, 503)
    assert.equal(sent.data.devOtp, undefined)
  } finally {
    process.env.OTP_DEV_MODE = ''
  }
})

const googleClientId = 'test-client.apps.googleusercontent.com'
const googleKeys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
const otherKeys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })

// Builds an ID token the way Google does, signed with a key the mocked certificate endpoint serves.
function googleToken(claims = {}, { privateKey = googleKeys.privateKey, kid = 'test-kid' } = {}) {
  const now = Math.floor(Date.now() / 1000)
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const body = `${encode({ alg: 'RS256', kid, typ: 'JWT' })}.${encode({
    iss: 'https://accounts.google.com', aud: googleClientId, sub: '1234567890', email: 'google-player@gmail.com',
    email_verified: true, name: 'Google Player', iat: now, exp: now + 3600, ...claims,
  })}`
  return `${body}.${crypto.sign('RSA-SHA256', Buffer.from(body), privateKey).toString('base64url')}`
}

async function withGoogle(work) {
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    assert.equal(String(url), 'https://www.googleapis.com/oauth2/v3/certs')
    const jwk = googleKeys.publicKey.export({ format: 'jwk' })
    return new Response(JSON.stringify({ keys: [{ ...jwk, kid: 'test-kid', alg: 'RS256', use: 'sig' }] }), { headers: { 'cache-control': 'public, max-age=600' } })
  }
  process.env.GOOGLE_CLIENT_ID = googleClientId
  try {
    await work()
  } finally {
    globalThis.fetch = realFetch
    process.env.GOOGLE_CLIENT_ID = ''
  }
}

const google = (credential) => request('/api/auth/google', { body: { credential } })

test('the browser reads the Google client ID from the server', async () => {
  assert.deepEqual((await request('/api/auth/config', { method: 'GET' })).data, { googleClientId: '' })
  await withGoogle(async () => {
    assert.deepEqual((await request('/api/auth/config', { method: 'GET' })).data, { googleClientId })
  })
  assert.equal((await google(googleToken())).status, 503)
})

test('Google sign-in creates an account once and logs it in after that', async () => {
  await withGoogle(async () => {
    const first = await google(googleToken())
    assert.equal(first.status, 200, JSON.stringify(first.data))
    assert.equal(first.data.created, true)
    assert.deepEqual(first.data.user, { userKey: 'google-player@gmail.com', name: 'GooglePlayer', email: 'google-player@gmail.com', phone: '' })
    assert.match(first.data.loginSecret, /^[0-9a-f]{64}$/)

    const again = await google(googleToken({ name: 'Renamed At Google' }))
    assert.equal(again.data.created, false)
    assert.equal(again.data.user.name, 'GooglePlayer')
    assert.equal(again.data.loginSecret, first.data.loginSecret)

    const wallet = await request('/api/users/wallet', { body: { userKey: 'google-player@gmail.com', password: first.data.loginSecret } })
    assert.equal(wallet.status, 200)
    assert.equal((await login('google-player@gmail.com', first.data.loginSecret)).status, 401)

    const sameName = await google(googleToken({ sub: '999', email: 'second-google@gmail.com' }))
    assert.match(sameName.data.user.name, /^GooglePlayer\d+$/)
  })
})

test('Google sign-in rejects forged, expired and foreign tokens', async () => {
  await withGoogle(async () => {
    const now = Math.floor(Date.now() / 1000)
    for (const credential of [
      'not-a-token',
      googleToken({}, { privateKey: otherKeys.privateKey }),
      googleToken({ aud: 'someone-else.apps.googleusercontent.com' }),
      googleToken({ iss: 'https://evil.example.com' }),
      googleToken({ exp: now - 600, iat: now - 4200 }),
      googleToken({ email_verified: false }),
      googleToken({}, { kid: 'unknown-kid' }),
    ]) {
      const result = await google(credential)
      assert.equal(result.status, 401, `${credential.slice(0, 20)}: ${JSON.stringify(result.data)}`)
    }
  })
})

test('Google sign-in logs into an email account without revealing its password', async () => {
  await makeAccount('both@gmail.com', 'BothWays', 'my-own-password')
  await withGoogle(async () => {
    const result = await google(googleToken({ email: 'both@gmail.com', sub: '42' }))
    assert.equal(result.data.created, false)
    assert.equal(result.data.user.userKey, 'both@gmail.com')
    assert.notEqual(result.data.loginSecret, 'my-own-password')
    assert.equal((await login('both@gmail.com', 'my-own-password')).status, 200)

    // A password reset signs out every device, Google ones included.
    const sent = await forgot('both@gmail.com')
    assert.equal(sent.status, 200, JSON.stringify(sent.data))
    await reset({ email: 'both@gmail.com', otpToken: sent.data.otpToken, otp: sent.data.devOtp, password: 'brand-new-pass' })
    assert.equal((await request('/api/users/wallet', { body: { userKey: 'both@gmail.com', password: result.data.loginSecret } })).status, 403)
    const fresh = await google(googleToken({ email: 'both@gmail.com', sub: '42' }))
    assert.notEqual(fresh.data.loginSecret, result.data.loginSecret)
  })
})

test('Google sign-in takes back an account that only a browser re-sync created', async () => {
  await request('/api/users/sync', { body: { users: [{ userKey: 'squatted@gmail.com', email: 'squatted@gmail.com', name: 'Squatter2', password: 'squatter-pass' }] } })
  await withGoogle(async () => {
    const result = await google(googleToken({ email: 'squatted@gmail.com', sub: '77' }))
    assert.equal(result.status, 200)
    assert.equal((await login('squatted@gmail.com', 'squatter-pass')).status, 401)
  })
})

// A minimal SMTP server that accepts one login and records each message it receives.
function startFakeSmtp() {
  const messages = []
  const server = net.createServer((socket) => {
    let data = null
    let buffer = ''
    const reply = (line) => socket.write(`${line}\r\n`)
    reply('220 fake.smtp ready')
    socket.on('data', (chunk) => {
      buffer += chunk
      let index
      while ((index = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, index)
        buffer = buffer.slice(index + 2)
        if (data !== null) {
          if (line === '.') { messages.push(data); data = null; reply('250 queued') } else data += `${line}\n`
        } else if (/^(EHLO|HELO)/i.test(line)) reply('250-fake.smtp\r\n250 AUTH PLAIN LOGIN')
        else if (/^AUTH PLAIN/i.test(line)) {
          const [, user, pass] = Buffer.from(line.split(' ')[2], 'base64').toString().split('\0')
          reply(user === 'arenacore@gmail.com' && pass === 'abcdefghijklmnop' ? '235 ok' : '535 bad login')
        } else if (/^DATA/i.test(line)) { data = ''; reply('354 go') }
        else if (/^QUIT/i.test(line)) { reply('221 bye'); socket.end() }
        else reply('250 ok')
      }
    })
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, messages, port: server.address().port })))
}

test('Gmail sends the code by email with the app password', async () => {
  const smtp = await startFakeSmtp()
  Object.assign(process.env, { GMAIL_USER: 'arenacore@gmail.com', GMAIL_APP_PASSWORD: 'abcd efgh ijkl mnop', SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtp.port) })
  try {
    const sent = await send({ email: 'gmail-player@test.com', displayName: 'GmailPlayer' })
    assert.equal(sent.status, 200, JSON.stringify(sent.data))
    assert.equal(sent.data.devOtp, undefined)
    assert.equal(smtp.messages.length, 1)
    const code = smtp.messages[0].match(/Subject: (\d{6}) is your ArenaCore sign-up code/)?.[1]
    assert.ok(code, smtp.messages[0])
    assert.match(smtp.messages[0], /To: gmail-player@test\.com/)

    const created = await register({ email: 'gmail-player@test.com', displayName: 'GmailPlayer', password: 'secret123', otpToken: sent.data.otpToken, otp: code })
    assert.equal(created.status, 200, JSON.stringify(created.data))

    process.env.GMAIL_APP_PASSWORD = 'wrong password'
    const failed = await send({ email: 'gmail-player2@test.com', displayName: 'GmailPlayer2' })
    assert.equal(failed.status, 502)
  } finally {
    for (const key of ['GMAIL_USER', 'GMAIL_APP_PASSWORD', 'SMTP_HOST', 'SMTP_PORT']) delete process.env[key]
    smtp.server.close()
  }
})
