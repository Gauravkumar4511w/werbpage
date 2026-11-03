/* global process, Buffer */
import crypto from 'node:crypto'

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

// Indian numbers are typed as "98765 43210" or "+91 98765 43210"; other countries need their + code.
export function normalizePhone(value) {
  const raw = String(value || '').trim()
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 10 && !raw.startsWith('+')) return `+91${digits}`
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`
  if (raw.startsWith('+') && digits.length >= 10 && digits.length <= 15) return `+${digits}`
  return ''
}

export function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase()
  return /^\S+@\S+\.\S+$/.test(email) ? email : ''
}

export function otpTarget({ channel, email, phone }) {
  if (channel === 'email') return normalizeEmail(email)
  if (channel === 'phone') return normalizePhone(phone)
  return ''
}

export function maskTarget(channel, target) {
  if (channel === 'email') {
    const [name, domain] = target.split('@')
    return `${name.slice(0, 2)}${'*'.repeat(Math.max(1, name.length - 2))}@${domain}`
  }
  return `${target.slice(0, 3)} ******${target.slice(-4)}`
}

export function generateOtp() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0')
}

// The token is stateless and signed, so the code sent by one serverless instance verifies on another.
// It holds a keyed hash of the code, never the code itself.
export function signOtpToken({ channel, target, otp, now = Date.now() }) {
  const nonce = crypto.randomBytes(16).toString('base64url')
  const expiresAt = now + OTP_TTL_MS
  const payload = Buffer.from(JSON.stringify({ channel, target, expiresAt, nonce, code: hmac(`code.${nonce}.${target}.${otp}`) })).toString('base64url')
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

// MSG91 needs a DLT-approved OTP template as well as the auth key.
function hasMsg91() {
  return Boolean(process.env.MSG91_AUTH_KEY && process.env.MSG91_TEMPLATE_ID)
}

export function hasSmsProvider() {
  return Boolean(hasMsg91() || process.env.FAST2SMS_API_KEY || (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && (process.env.TWILIO_FROM || process.env.TWILIO_MESSAGING_SERVICE_SID)))
}

export function hasEmailProvider() {
  return Boolean(process.env.RESEND_API_KEY && process.env.OTP_EMAIL_FROM)
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
  return new Error(`${fallback}${detail ? ` (${Array.isArray(detail) ? detail.join(', ') : detail})` : ''}`)
}

async function sendSms(phone, otp) {
  if (hasMsg91()) {
    const query = new URLSearchParams({ template_id: process.env.MSG91_TEMPLATE_ID, mobile: phone.slice(1), otp, otp_expiry: '10' })
    const response = await fetch(`https://control.msg91.com/api/v5/otp?${query}`, {
      method: 'POST',
      headers: { authkey: process.env.MSG91_AUTH_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ otp }),
    })
    const data = await response.clone().json().catch(() => null)
    if (!response.ok || data?.type === 'error') throw await providerError(response, 'Could not send the SMS code')
    return
  }
  if (process.env.FAST2SMS_API_KEY && phone.startsWith('+91')) {
    const response = await fetch('https://www.fast2sms.com/dev/bulkV2', {
      method: 'POST',
      headers: { authorization: process.env.FAST2SMS_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ route: 'otp', variables_values: otp, numbers: phone.slice(3) }),
    })
    const data = await response.clone().json().catch(() => null)
    if (!response.ok || data?.return === false) throw await providerError(response, 'Could not send the SMS code')
    return
  }
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    const form = new URLSearchParams({ To: phone, Body: `${otp} is your ArenaCore verification code. It expires in 10 minutes.` })
    if (process.env.TWILIO_MESSAGING_SERVICE_SID) form.set('MessagingServiceSid', process.env.TWILIO_MESSAGING_SERVICE_SID)
    else form.set('From', process.env.TWILIO_FROM)
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(process.env.TWILIO_ACCOUNT_SID)}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form,
    })
    if (!response.ok) throw await providerError(response, 'Could not send the SMS code')
    return
  }
  throw Object.assign(new Error('SMS codes can only be sent to Indian (+91) numbers right now.'), { status: 400 })
}

async function sendEmail(email, otp) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.OTP_EMAIL_FROM,
      to: [email],
      subject: `${otp} is your ArenaCore code`,
      text: `Your ArenaCore verification code is ${otp}. It expires in 10 minutes. If you did not sign up, ignore this email.`,
      html: `<p>Your ArenaCore verification code is</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${otp}</p><p>It expires in 10 minutes. If you did not sign up, ignore this email.</p>`,
    }),
  })
  if (!response.ok) throw await providerError(response, 'Could not send the email code')
}

// Returns { devOtp } when no provider is set up and dev mode allows showing the code.
export async function deliverOtp({ channel, target, otp }) {
  const configured = channel === 'email' ? hasEmailProvider() : hasSmsProvider()
  if (!configured) {
    if (otpDevMode()) return { devOtp: otp }
    throw Object.assign(new Error(channel === 'email'
      ? 'Email verification is not set up yet. Sign up with your mobile number or try again later.'
      : 'SMS verification is not set up yet. Sign up with your email or try again later.'), { status: 503 })
  }
  try {
    if (channel === 'email') await sendEmail(target, otp)
    else await sendSms(target, otp)
  } catch (error) {
    if (error.status) throw error
    console.error('OTP delivery failed:', error)
    throw Object.assign(new Error('Could not send the code right now. Please try again in a minute.'), { status: 502 })
  }
  return {}
}
