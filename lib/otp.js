/* global process, Buffer */
import crypto from 'node:crypto'
import nodemailer from 'nodemailer'

export const OTP_TTL_MS = 10 * 60 * 1000
export const OTP_RESEND_MS = 30 * 1000
export const OTP_MAX_ATTEMPTS = 5

// Used only when no secret is configured; tokens then only verify on the instance that issued them.
const fallbackSecret = crypto.randomBytes(32).toString('hex')

function otpSecret() {
  return process.env.OTP_SECRET || process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_PASSWORD || fallbackSecret
}

function hmac(value) {
  return crypto.createHmac('sha256', otpSecret()).update(value).digest('base64url')
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a))
  const right = Buffer.from(String(b))
  return left.length === right.length && crypto.timingSafeEqual(left, right)
}

export function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase()
  return /^\S+@\S+\.\S+$/.test(email) ? email : ''
}

export function maskEmail(email) {
  const [name, domain] = email.split('@')
  return `${name.slice(0, 2)}${'*'.repeat(Math.max(1, name.length - 2))}@${domain}`
}

export function generateOtp() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0')
}

// The token is stateless and signed, so the code sent by one serverless instance verifies on another.
// It holds a keyed hash of the code, never the code itself. The purpose ('signup' or 'reset') stops a
// sign-up code from resetting a password.
export function signOtpToken({ purpose, target, otp, now = Date.now() }) {
  const nonce = crypto.randomBytes(16).toString('base64url')
  const expiresAt = now + OTP_TTL_MS
  const payload = Buffer.from(JSON.stringify({ purpose, target, expiresAt, nonce, code: hmac(`code.${nonce}.${target}.${otp}`) })).toString('base64url')
  return { token: `otp1.${payload}.${hmac(`otp1.${payload}`)}`, expiresAt }
}

export function readOtpToken(token, now = Date.now()) {
  const [version, payload, signature, extra] = String(token || '').split('.')
  if (version !== 'otp1' || !payload || !signature || extra !== undefined) return null
  if (!safeEqual(signature, hmac(`${version}.${payload}`))) return null
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    if (!Number.isSafeInteger(data.expiresAt) || data.expiresAt <= now) return { ...data, expired: true }
    return data
  } catch {
    return null
  }
}

export function otpMatches(data, otp) {
  const code = String(otp || '').trim()
  return /^\d{6}$/.test(code) && safeEqual(data.code, hmac(`code.${data.nonce}.${data.target}.${code}`))
}

// Gmail sends with an App Password: Google Account > Security > 2-Step Verification > App passwords.
// SMTP_HOST and SMTP_PORT send through another SMTP server with the same login instead.
function hasSmtp() {
  return Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD)
}

export function hasEmailProvider() {
  return Boolean(hasSmtp() || (process.env.RESEND_API_KEY && process.env.OTP_EMAIL_FROM))
}

// Without a provider the code is shown on screen, which is only safe while developing locally.
// OTP_DEV_MODE=true forces it on (e.g. a staging deploy); OTP_DEV_MODE=false forces it off.
export function otpDevMode() {
  if (process.env.OTP_DEV_MODE === 'true') return true
  if (process.env.OTP_DEV_MODE === 'false') return false
  return !process.env.VERCEL && process.env.NODE_ENV !== 'production'
}

async function providerError(response, fallback) {
  const data = await response.json().catch(() => null)
  const detail = data?.message || data?.error?.message || data?.error || ''
  return new Error(`${fallback}${detail ? ` (${detail})` : ''}`)
}

function emailContent(purpose, otp) {
  const lines = purpose === 'reset'
    ? ['Your ArenaCore password reset code is', 'If you did not ask to reset your password, ignore this email. Your password stays the same.']
    : ['Your ArenaCore verification code is', 'If you did not sign up, ignore this email.']
  return {
    subject: `${otp} is your ArenaCore ${purpose === 'reset' ? 'password reset' : 'sign-up'} code`,
    text: `${lines[0]} ${otp}. It expires in 10 minutes. ${lines[1]}`,
    html: `<p>${lines[0]}</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${otp}</p><p>It expires in 10 minutes. ${lines[1]}</p>`,
  }
}

async function sendEmail(email, purpose, otp) {
  if (hasSmtp()) {
    const auth = { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD.replace(/\s/g, '') }
    const port = Number(process.env.SMTP_PORT || 465)
    // Short timeouts so a stuck mail server fails the request instead of the serverless function.
    const timeouts = { connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000 }
    const transport = nodemailer.createTransport(process.env.SMTP_HOST
      ? { host: process.env.SMTP_HOST, port, secure: port === 465, auth, ...timeouts }
      : { service: 'gmail', auth, ...timeouts })
    await transport.sendMail({ from: { name: 'ArenaCore', address: process.env.GMAIL_USER }, to: email, ...emailContent(purpose, otp) })
    return
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.OTP_EMAIL_FROM, to: [email], ...emailContent(purpose, otp) }),
  })
  if (!response.ok) throw await providerError(response, 'Could not send the email code')
}

// Returns { devOtp } when no provider is set up and dev mode allows showing the code.
export async function deliverOtp({ purpose, email, otp }) {
  if (!hasEmailProvider()) {
    if (otpDevMode()) return { devOtp: otp }
    throw Object.assign(new Error('Email codes are not set up yet. Please try again later.'), { status: 503 })
  }
  try {
    await sendEmail(email, purpose, otp)
  } catch (error) {
    console.error('OTP delivery failed:', error)
    throw Object.assign(new Error('Could not send the code right now. Please try again in a minute.'), { status: 502 })
  }
  return {}
}
