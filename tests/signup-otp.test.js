/* global process, Buffer */
import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import fs from 'node:fs'
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

test('sending a code checks the details and never puts the code in the token', async () => {
  assert.equal((await send({ channel: 'phone', phone: '12', displayName: 'Kite' })).status, 400)
  assert.equal((await send({ channel: 'email', email: 'not-an-email', displayName: 'Kite' })).status, 400)
  assert.equal((await send({ channel: 'email', email: 'kite@test.com', displayName: 'K' })).status, 400)

  const sent = await send({ channel: 'phone', phone: '98765 43210', displayName: 'Kite' })
  assert.equal(sent.status, 200, JSON.stringify(sent.data))
  assert.match(sent.data.devOtp, /^\d{6}$/)
  assert.equal(sent.data.sentTo, '+91 ******3210')
  assert.equal(sent.data.resendAfterMs, 30000)
  assert.ok(!Buffer.from(sent.data.otpToken.split('.')[1], 'base64url').toString().includes(sent.data.devOtp))

  const again = await send({ channel: 'phone', phone: '+91 98765 43210', displayName: 'Kite' })
  assert.equal(again.status, 429)
  assert.match(again.data.message, /wait \d+ seconds/)
})

test('an account is created only with the right code for that exact contact', async () => {
  const details = { channel: 'email', email: 'Shadow@Test.com', displayName: 'ShadowKite', password: 'secret123' }
  const sent = await send(details)
  const otp = sent.data.devOtp
  const wrongCode = otp === '000000' ? '111111' : '000000'

  assert.equal((await register({ ...details, otp })).status, 400)
  assert.equal((await register({ ...details, email: 'other@test.com', otpToken: sent.data.otpToken, otp })).status, 400)
  assert.equal((await register({ ...details, otpToken: `${sent.data.otpToken}x`, otp })).status, 400)
  const wrong = await register({ ...details, otpToken: sent.data.otpToken, otp: wrongCode })
  assert.equal(wrong.status, 400)
  assert.match(wrong.data.message, /4 tries left/)

  const created = await register({ ...details, otpToken: sent.data.otpToken, otp })
  assert.equal(created.status, 200, JSON.stringify(created.data))
  assert.equal(created.data.user.user_key, 'shadow@test.com')
  assert.equal(created.data.user.email, 'shadow@test.com')

  const login = await request('/api/users/login', { body: { login: 'shadow@test.com', password: 'secret123' } })
  assert.equal(login.status, 200)
  const reuse = await register({ ...details, password: 'attacker', otpToken: sent.data.otpToken, otp })
  assert.equal(reuse.status, 409)
})

test('five wrong codes lock the code out', async () => {
  const details = { channel: 'email', email: 'guesser@test.com', displayName: 'Guesser', password: 'secret123' }
  const sent = await send(details)
  const wrongCode = sent.data.devOtp === '000000' ? '111111' : '000000'
  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.equal((await register({ ...details, otpToken: sent.data.otpToken, otp: wrongCode })).status, 400)
  }
  const locked = await register({ ...details, otpToken: sent.data.otpToken, otp: sent.data.devOtp })
  assert.equal(locked.status, 429)
})

test('codes expire after ten minutes', async () => {
  const now = Date.now()
  const details = { channel: 'email', email: 'late@test.com', displayName: 'LatePlayer', password: 'secret123' }
  const sent = await db.requestSignupOtp(details, now)
  assert.throws(() => db.registerVerifiedUser({ ...details, otpToken: sent.otpToken, otp: sent.devOtp }, now + 10 * 60 * 1000 + 1), /expired/)
  assert.equal(db.registerVerifiedUser({ ...details, otpToken: sent.otpToken, otp: sent.devOtp }, now + 60 * 1000).user_key, 'late@test.com')
})

test('taken emails, numbers and gamer tags are refused before a code is sent', async () => {
  assert.equal((await signUp(request, { channel: 'phone', phone: '+91 91111 22222', displayName: 'TakenTag', password: 'secret123' })).status, 200)
  assert.equal((await send({ channel: 'phone', phone: '9111122222', displayName: 'NewTag' })).status, 409)
  assert.equal((await send({ channel: 'email', email: 'fresh@test.com', displayName: 'takentag' })).status, 409)
})

test('a verified sign-up claims an account that only a browser re-sync created', async () => {
  await request('/api/users/sync', { body: { users: [{ userKey: 'claimed@test.com', email: 'claimed@test.com', name: 'Squatter', password: 'squatter-pass' }] } })
  assert.equal((await request('/api/users/login', { body: { login: 'claimed@test.com', password: 'squatter-pass' } })).status, 200)

  const claimed = await signUp(request, { email: 'claimed@test.com', displayName: 'RealOwner', password: 'owner-pass' })
  assert.equal(claimed.status, 200, JSON.stringify(claimed.data))
  assert.equal(claimed.data.user.display_name, 'RealOwner')
  assert.equal((await request('/api/users/login', { body: { login: 'claimed@test.com', password: 'squatter-pass' } })).status, 401)
  assert.equal((await send({ channel: 'email', email: 'claimed@test.com', displayName: 'Another' })).status, 409)
})

test('without a provider outside dev mode the code is not shown', async () => {
  process.env.OTP_DEV_MODE = 'false'
  try {
    const sent = await send({ channel: 'email', email: 'prod@test.com', displayName: 'ProdPlayer' })
    assert.equal(sent.status, 503)
    assert.equal(sent.data.devOtp, undefined)
  } finally {
    delete process.env.OTP_DEV_MODE
  }
})

test('Fast2SMS receives the code for Indian numbers', async () => {
  const realFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    return new Response(JSON.stringify({ return: true, request_id: 'abc' }), { status: 200 })
  }
  process.env.FAST2SMS_API_KEY = 'test-key'
  try {
    const sent = await send({ channel: 'phone', phone: '+91 93333 44444', displayName: 'SmsPlayer' })
    assert.equal(sent.status, 200, JSON.stringify(sent.data))
    assert.equal(sent.data.devOtp, undefined)
    assert.equal(calls[0].url, 'https://www.fast2sms.com/dev/bulkV2')
    assert.equal(calls[0].options.headers.authorization, 'test-key')
    const body = JSON.parse(calls[0].options.body)
    assert.equal(body.route, 'otp')
    assert.equal(body.numbers, '9333344444')
    assert.match(body.variables_values, /^\d{6}$/)

    globalThis.fetch = async () => new Response(JSON.stringify({ return: false, message: 'Invalid key' }), { status: 401 })
    const failed = await send({ channel: 'phone', phone: '+91 95555 66666', displayName: 'SmsPlayer2' })
    assert.equal(failed.status, 502)
    assert.doesNotMatch(failed.data.message, /Invalid key/)
  } finally {
    globalThis.fetch = realFetch
    delete process.env.FAST2SMS_API_KEY
  }
})
