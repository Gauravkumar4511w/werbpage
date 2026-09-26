/* global process, Buffer */
import crypto from 'node:crypto'
import http from 'node:http'
import { fileURLToPath } from 'node:url'
import {
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
  updateMatchDetails,
  verifyAdminSession,
} from './lib/payout-db.js'

try { process.loadEnvFile?.() } catch {}

const port = Number(process.env.API_PORT || 8787)

function sendJson(response, statusCode, body) {
  if (response.headersSent) return
  if (typeof response.status === 'function' && typeof response.json === 'function') {
    response.status(statusCode).json(body)
    return
  }
  if (typeof response.setHeader === 'function') {
    response.setHeader('Content-Type', 'application/json')
  }
  if (typeof response.writeHead === 'function') {
    response.writeHead(statusCode, { 'Content-Type': 'application/json' })
  } else {
    response.statusCode = statusCode
  }
  response.end(JSON.stringify(body))
}

async function readBody(request) {
  if (request.body && typeof request.body === 'object') return request.body
  if (typeof request.body === 'string') {
    try { return JSON.parse(request.body) } catch { return {} }
  }
  let rawBody = ''
  for await (const chunk of request) rawBody += chunk
  if (!rawBody) return {}
  try {
    return JSON.parse(rawBody)
  } catch {
    return {}
  }
}

function razorpayAuth() {
  return `Basic ${Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64')}`
}

function hasRazorpayConfig() {
  return Boolean(
    process.env.RAZORPAY_KEY_ID &&
    process.env.RAZORPAY_KEY_SECRET &&
    !process.env.RAZORPAY_KEY_ID.startsWith('your_') &&
    !process.env.RAZORPAY_KEY_SECRET.startsWith('your_'),
  )
}

function getAdminToken(request) {
  const authorization = request.headers?.authorization || ''
  return authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
}

function requireAdmin(request, response) {
  const token = getAdminToken(request)
  if (!token || !verifyAdminSession(token)) {
    if (token) deleteAdminSession(token)
    sendJson(response, 401, { message: 'Admin authentication required.' })
    return false
  }
  return true
}

async function handleApiRequest(request, response) {
  if (typeof response.setHeader === 'function') {
    response.setHeader('Access-Control-Allow-Origin', '*')
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  }

  if (request.method === 'OPTIONS') {
    if (typeof response.writeHead === 'function') {
      response.writeHead(204)
    } else {
      response.statusCode = 204
    }
    response.end()
    return
  }

  const host = request.headers?.host || 'localhost'
  const urlObj = new URL(request.url || '/', `http://${host}`)

  let rawPath = urlObj.searchParams.get('_api_path') ||
                urlObj.searchParams.get('_route') ||
                urlObj.searchParams.get('route') ||
                request.headers?.['x-matched-path'] ||
                urlObj.pathname

  if (rawPath && !rawPath.startsWith('/')) {
    rawPath = `/api/${rawPath}`
  } else if (rawPath && !rawPath.startsWith('/api') && rawPath !== '/') {
    rawPath = `/api${rawPath}`
  }

  const pathname = (rawPath || '/').split('?')[0].replace(/\.js$/, '').replace(/\/$/, '') || '/'

  if (request.method === 'POST' && pathname === '/api/admin/login') {
    try {
      const body = await readBody(request)
      if (!authenticateAdmin(body.email, body.password)) {
        sendJson(response, 401, { message: 'Invalid admin credentials.' })
        return
      }
      const session = createAdminSession()
      sendJson(response, 200, session)
    } catch (error) {
      sendJson(response, 400, { message: error instanceof Error ? error.message : 'Invalid request.' })
    }
    return
  }

  if (request.method === 'POST' && pathname === '/api/admin/matches/register') {
    if (!requireAdmin(request, response)) return
    try {
      registerMatch(await readBody(request))
      sendJson(response, 201, { registered: true })
    } catch (error) {
      sendJson(response, 400, { message: error instanceof Error ? error.message : 'Could not register match.' })
    }
    return
  }

  if (request.method === 'POST' && pathname === '/api/admin/matches/confirm-result') {
    if (!requireAdmin(request, response)) return
    try {
      const payout = confirmMatchResult(await readBody(request))
      sendJson(response, 200, { confirmed: true, payout })
    } catch (error) {
      sendJson(response, 400, { message: error instanceof Error ? error.message : 'Could not confirm match result.' })
    }
    return
  }

  if (request.method === 'PATCH' && pathname === '/api/admin/matches/update') {
    if (!requireAdmin(request, response)) return
    try {
      sendJson(response, 200, { match: updateMatchDetails(await readBody(request)) })
    } catch (error) {
      sendJson(response, 400, { message: error instanceof Error ? error.message : 'Could not update match.' })
    }
    return
  }

  if (request.method === 'POST' && pathname === '/api/admin/matches/create') {
    if (!requireAdmin(request, response)) return
    try {
      sendJson(response, 201, { match: createAdminMatch(await readBody(request)) })
    } catch (error) {
      sendJson(response, 400, { message: error instanceof Error ? error.message : 'Could not create match.' })
    }
    return
  }

  if (request.method === 'DELETE' && pathname === '/api/admin/matches/delete') {
    if (!requireAdmin(request, response)) return
    try {
      sendJson(response, 200, deleteAdminMatch((await readBody(request)).matchId))
    } catch (error) {
      sendJson(response, 400, { message: error instanceof Error ? error.message : 'Could not delete match.' })
    }
    return
  }

  if (request.method === 'GET' && pathname === '/api/admin/overview') {
    if (!requireAdmin(request, response)) return
    sendJson(response, 200, getAdminOverview())
    return
  }

  if (request.method === 'POST' && pathname === '/api/admin/users/credit') {
    if (!requireAdmin(request, response)) return
    try {
      sendJson(response, 200, { user: adjustCreditCoins(await readBody(request)) })
    } catch (error) {
      sendJson(response, 400, { message: error instanceof Error ? error.message : 'Could not update credits.' })
    }
    return
  }

  if (request.method === 'POST' && pathname === '/api/admin/matches/kills') {
    if (!requireAdmin(request, response)) return
    try {
      recordMatchKills(await readBody(request))
      sendJson(response, 200, { recorded: true })
    } catch (error) {
      sendJson(response, 400, { message: error instanceof Error ? error.message : 'Could not save kills.' })
    }
    return
  }

  if (request.method === 'POST' && pathname === '/api/payments/request') {
    try {
      recordPaymentRequest(await readBody(request))
      sendJson(response, 201, { recorded: true })
    } catch (error) {
      sendJson(response, 400, { message: error instanceof Error ? error.message : 'Could not record payment request.' })
    }
    return
  }

  if (request.method === 'POST' && pathname === '/api/matches/entry') {
    try {
      recordMatchEntry(await readBody(request))
      sendJson(response, 201, { recorded: true })
    } catch (error) {
      sendJson(response, 400, { message: error instanceof Error ? error.message : 'Could not record match entry.' })
    }
    return
  }

  if (request.method === 'POST' && pathname === '/api/matches/catalog') {
    try {
      registerMatchCatalog((await readBody(request)).matches)
      sendJson(response, 201, { recorded: true })
    } catch (error) {
      sendJson(response, 400, { message: error instanceof Error ? error.message : 'Could not record match catalog.' })
    }
    return
  }

  if (request.method === 'GET' && pathname === '/api/matches/catalog') {
    sendJson(response, 200, { matches: getPublicMatchCatalog() })
    return
  }

  if (request.method === 'POST' && pathname === '/api/withdrawals/request') {
    try {
      recordWithdrawalRequest(await readBody(request))
      sendJson(response, 201, { recorded: true })
    } catch (error) {
      sendJson(response, 400, { message: error instanceof Error ? error.message : 'Could not record withdrawal request.' })
    }
    return
  }

  if (request.method === 'POST' && pathname === '/api/payments/razorpay/order') {
    if (!hasRazorpayConfig()) {
      sendJson(response, 503, { message: 'Razorpay is not configured. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to .env.' })
      return
    }

    try {
      const body = await readBody(request)
      const coins = Number(body.coins)
      if (!Number.isInteger(coins) || coins < 50) {
        sendJson(response, 400, { message: 'Buy at least 50 whole coins.' })
        return
      }

      const razorpayResponse = await fetch('https://api.razorpay.com/v1/orders', {
        method: 'POST',
        headers: { Authorization: razorpayAuth(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: coins * 100, currency: 'INR', receipt: `arenacore-${Date.now()}`, notes: { coins: String(coins) } }),
      })
      const data = await razorpayResponse.json()
      if (!razorpayResponse.ok) {
        sendJson(response, 502, { message: data.error?.description || 'Could not create Razorpay order.' })
        return
      }
      sendJson(response, 200, { orderId: data.id, amount: data.amount, currency: data.currency, coins })
    } catch (error) {
      sendJson(response, 502, { message: error instanceof Error ? error.message : 'Could not create payment order.' })
    }
    return
  }

  if (request.method === 'POST' && pathname === '/api/payments/razorpay/verify') {
    try {
      const body = await readBody(request)
      const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = body
      if (!orderId || !paymentId || !signature || !process.env.RAZORPAY_KEY_SECRET) {
        sendJson(response, 400, { message: 'Incomplete payment verification data.' })
        return
      }

      const expectedSignature = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex')
      const providedSignature = Buffer.from(signature)
      const calculatedSignature = Buffer.from(expectedSignature)
      if (providedSignature.length !== calculatedSignature.length || !crypto.timingSafeEqual(providedSignature, calculatedSignature)) {
        sendJson(response, 400, { message: 'Payment signature could not be verified.' })
        return
      }

      const paymentResponse = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}`, { headers: { Authorization: razorpayAuth() } })
      const payment = await paymentResponse.json()
      if (!paymentResponse.ok || payment.order_id !== orderId || payment.status !== 'captured') {
        sendJson(response, 400, { message: 'Payment is not captured yet.' })
        return
      }

      const coins = Number(payment.amount) / 100
      if (!Number.isInteger(coins) || coins < 50) {
        sendJson(response, 400, { message: 'Invalid payment amount.' })
        return
      }
      sendJson(response, 200, { verified: true, paymentId, coins })
    } catch (error) {
      sendJson(response, 502, { message: error instanceof Error ? error.message : 'Payment verification failed.' })
    }
    return
  }

  sendJson(response, 404, { message: 'Not found' })
}

const isDirectExecution = process.argv[1] && (
  process.argv[1].endsWith('server.js') ||
  process.argv[1] === fileURLToPath(import.meta.url)
)

if (isDirectExecution) {
  const server = http.createServer(handleApiRequest)
  server.listen(port, () => console.log(`Payment API listening on http://localhost:${port}`))
}

export { handleApiRequest }
export default handleApiRequest
