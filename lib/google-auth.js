/* global Buffer */
import crypto from 'node:crypto'

// "Sign in with Google" hands the browser a signed ID token (a JWT). The server checks its signature
// against Google's published keys, so a browser cannot claim an email it does not own.
const GOOGLE_CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs'
const GOOGLE_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com'])
const CLOCK_SKEW_SECONDS = 60

let cachedKeys = { keys: new Map(), expiresAt: 0 }

async function googleKey(kid, now) {
  if (cachedKeys.keys.has(kid) && cachedKeys.expiresAt > now) return cachedKeys.keys.get(kid)
  const response = await fetch(GOOGLE_CERTS_URL)
  if (!response.ok) throw new Error('Could not reach Google to check the sign-in.')
  const { keys = [] } = await response.json()
  const maxAge = Number(/max-age=(\d+)/.exec(response.headers.get('cache-control') || '')?.[1]) || 3600
  cachedKeys = {
    keys: new Map(keys.map((jwk) => [jwk.kid, crypto.createPublicKey({ key: jwk, format: 'jwk' })])),
    expiresAt: now + maxAge * 1000,
  }
  return cachedKeys.keys.get(kid)
}

function decodePart(part) {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))
}

function invalid(message = 'Google sign-in could not be verified. Please try again.') {
  return Object.assign(new Error(message), { status: 401 })
}

// Returns { email, name, sub } for a valid token issued to this site's client ID.
export async function verifyGoogleCredential(credential, clientId, now = Date.now()) {
  if (!clientId) throw Object.assign(new Error('Google sign-in is not set up yet.'), { status: 503 })
  const parts = String(credential || '').split('.')
  if (parts.length !== 3) throw invalid()
  let header
  let claims
  try {
    header = decodePart(parts[0])
    claims = decodePart(parts[1])
  } catch {
    throw invalid()
  }
  if (header.alg !== 'RS256' || !header.kid) throw invalid()
  const key = await googleKey(header.kid, now)
  if (!key) throw invalid()
  const signed = crypto.verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], 'base64url'))
  if (!signed) throw invalid()

  const nowSeconds = now / 1000
  if (!GOOGLE_ISSUERS.has(claims.iss) || claims.aud !== clientId) throw invalid()
  if (!(claims.exp > nowSeconds - CLOCK_SKEW_SECONDS) || claims.iat > nowSeconds + CLOCK_SKEW_SECONDS) {
    throw invalid('Google sign-in expired. Please try again.')
  }
  if (!claims.email || claims.email_verified !== true) throw invalid('Your Google account has no verified email address.')
  return { email: String(claims.email).toLowerCase(), name: String(claims.name || claims.given_name || ''), sub: String(claims.sub) }
}
