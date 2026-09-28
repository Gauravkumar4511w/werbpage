/* global Buffer */
import crypto from 'node:crypto'

export function signAdminSession(secret, expiresAt) {
  const payload = Buffer.from(JSON.stringify({ expiresAt, nonce: crypto.randomBytes(32).toString('hex') })).toString('base64url')
  const signature = crypto.createHmac('sha256', secret).update(`v1.${payload}`).digest('base64url')
  return `v1.${payload}.${signature}`
}

export function verifySignedAdminSession(token, secret, now = Date.now()) {
  if (typeof token !== 'string' || !secret) return false
  const [version, payload, signature, extra] = token.split('.')
  if (version !== 'v1' || !payload || !signature || extra !== undefined) return false
  const expected = crypto.createHmac('sha256', secret).update(`${version}.${payload}`).digest('base64url')
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    return Number.isSafeInteger(session.expiresAt) && session.expiresAt > now && typeof session.nonce === 'string'
  } catch {
    return false
  }
}
