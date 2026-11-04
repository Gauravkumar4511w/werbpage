/* global process, Buffer */
import crypto from 'node:crypto'
import http from 'node:http'
import { fileURLToPath } from 'node:url'
import {
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
  updateMatchDetails,
  verifyAdminSession,
  recordUserPresence,
  getLiveStats,
  loginUser,
  registerOrUpdateUser,
  registerVerifiedUser,
  requestSignupOtp,
  requestPasswordResetOtp,
  resetPassword,
  loginWithGoogle,
  updateUserProfile,
  syncUsers,
  adminSetUserStatus,
  getAdminNotifications,
  markAdminNotificationsRead,
  getAdminUserDetail,
  getAuthorizedWallet,
  reviewPaymentRequest,
  reviewWithdrawalRequest,
} from './lib/payout-db.js'

try { process.loadEnvFile?.() } catch { /* Deployed environments may not have a local .env file. */ }

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

function sendError(response, error, fallbackMessage) {
  sendJson(response, error?.status || 400, { message: error instanceof Error ? error.message : fallbackMessage })
}

function getAdminToken(request) {
  const authorization = request.headers?.authorization || ''
  return authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
}

async function requireAdmin(request, response) {
  const token = getAdminToken(request)
  if (!token || !await verifyAdminSession(token)) {
    if (token) await deleteAdminSession(token)
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

  let rawPath = request.query?._api_path ||
                urlObj.searchParams.get('_api_path') ||
                urlObj.searchParams.get('_route') ||
                urlObj.searchParams.get('route') ||
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
      if (!await authenticateAdmin(body.email, body.password)) {
        sendJson(response, 401, { message: 'Invalid admin credentials.' })
        return
      }
      const session = await createAdminSession()
      sendJson(response, 200, session)
    } catch (error) {
      sendJson(response, 400, { message: error instanceof Error ? error.message : 'Invalid request.' })
    }
    return
  }

  if (request.method === 'POST' && pathname === '/api/admin/matches/register') {
    if (!await requireAdmin(request, response)) return
    try {
      await registerMatch(await readBody(request))
      sendJson(response, 201, { registered: true })
    } catch (error) {
      sendJson(response, 400, { message: error instanceof Error ? error.message : 'Could not register match.' })
    }
    return
  }

  if (request.method === 'POST' && pathname === '/api/admin/matches/confirm-result') {
    if (!await requireAdmin(request, response)) return
    try {
      const payout = await confirmMatchResult(await readBody(request))
      sendJson(response, 200, { confirmed: true, payout })
    } catch (error) {
      sendJson(response, 400, { message: error instanceof Error ? error.message : 'Could not confirm match result.' })
    }
    return
  }

  if (request.method === 'PATCH' && pathname === '/api/admin/matches/update') {
    if (!await requireAdmin(request, response)) return
    try {
      sendJson(response, 200, { match: await updateMatchDetails(await readBody(request)) })
    } catch (error) {
      sendJson(response, 400, { message: error instanceof Error ? error.message : 'Could not update match.' })
    }
    return
  }

  if (request.method === 'POST' && pathname === '/api/admin/matches/create') {
    if (!await requireAdmin(request, response)) return
    try {
      sendJson(response, 201, { match: await createAdminMatch(await readBody(request)) })
    } catch (error) {
      sendJson(response, 400, { message: error instanceof Error ? error.message : 'Could not create match.' })
    }
    return
  }

  if (request.method === 'DELETE' && pathname === '/api/admin/matches/delete') {
    if (!await requireAdmin(request, response)) return
    try {
      sendJson(response, 200, await deleteAdminMatch((await readBody(request)).matchId))
    } catch (error) {
      sendJson(response, 400, { message: error instanceof Error ? error.message : 'Could not delete match.' })
    }
    return
  }

  if (request.method === 'GET' && pathname === '/api/admin/overview') {
    if (!await requireAdmin(request, response)) return
    sendJson(response, 200, await getAdminOverview())
    return
  }

  if (request.method === 'GET' && (pathname === '/api/presence/stats' || pathname === '/api/presence/live-count')) {
    sendJson(response, 200, await getLiveStats())
    return
  }

  if (request.method === 'POST' && pathname === '/api/presence/heartbeat') {
    try {
      const body = await readBody(request)
      const stats = await recordUserPresence({
        sessionId: body.sessionId,
        userKey: body.userKey,
        ip: request.headers?.['x-forwarded-for'] || request.socket?.remoteAddress || '',
      })
      sendJson(response, 200, { success: true, ...stats })
    } catch (error) {
      sendJson(response, 400, { message: error instanceof Error ? error.message : 'Could not record heartbeat.' })
    }
    return
  }

  // The browser reads the Google client ID here, so GOOGLE_CLIENT_ID is the only setting to change.
  if (request.method === 'GET' && pathname === '/api/auth/config') {
    sendJson(response, 200, { googleClientId: process.env.GOOGLE_CLIENT_ID || '' })
    return
  }

  if (request.method === 'POST' && pathname === '/api/auth/google') {
    try {
      const body = await readBody(request)
      const result = await loginWithGoogle(body)
      if (body.sessionId) await recordUserPresence({ sessionId: body.sessionId, userKey: result.user.userKey })
      sendJson(response, 200, result)
    } catch (error) {
      sendError(response, error, 'Could not sign in with Google.')
    }
    return
  }

  if (request.method === 'POST' && pathname === '/api/auth/password/forgot') {
    try {
      sendJson(response, 200, await requestPasswordResetOtp(await readBody(request)))
    } catch (error) {
      sendError(response, error, 'Could not send the code.')
    }
    return
  }

  if (request.method === 'POST' && pathname === '/api/auth/password/reset') {
    try {
      const body = await readBody(request)
      const user = await resetPassword(body)
      if (body.sessionId) await recordUserPresence({ sessionId: body.sessionId, userKey: user.userKey })
      sendJson(response, 200, { user })
    } catch (error) {
      sendError(response, error, 'Could not reset the password.')
    }
    return
  }

  if (request.method === 'POST' && pathname === '/api/auth/otp/send') {
    try {
      sendJson(response, 200, await requestSignupOtp(await readBody(request)))
    } catch (error) {
      sendError(response, error, 'Could not send the code.')
    }
    return
  }

  // New players must send the code from /api/auth/otp/send; see await registerVerifiedUser().
  if (request.method === 'POST' && pathname === '/api/users/register') {
    try {
      const body = await readBody(request)
      const user = await registerVerifiedUser(body)
      if (body.sessionId) {
        await recordUserPresence({ sessionId: body.sessionId, userKey: user.user_key })
      }
      sendJson(response, 200, { success: true, user })
    } catch (error) {
      sendError(response, error, 'Could not register user.')
    }
    return
  }

  if (request.method === 'POST' && pathname === '/api/users/login') {
    try {
      const body = await readBody(request)
      const user = await loginUser(body)
      if (body.sessionId) await recordUserPresence({ sessionId: body.sessionId, userKey: user.userKey })
      sendJson(response, 200, { user })
    } catch (error) {
      sendError(response, error, 'Could not log in.')
    }
    return
  }

  if (request.method === 'POST' && pathname === '/api/users/profile') {
    try {
      sendJson(response, 200, { user: await updateUserProfile(await readBody(request)) })
    } catch (error) {
      sendError(response, error, 'Could not save your profile.')
    }
    return
  }

  if (request.method === 'POST' && pathname === '/api/users/sync') {
    try {
      const body = await readBody(request)
      const users = await syncUsers(body.users)
      sendJson(response, 200, { success: true, count: users.length })
    } catch (error) {
      sendJson(response, 400, { message: error instanceof Error ? error.message : 'Could not sync users.' })
    }
    return
  }

  if (request.method === 'POST' && pathname === '/api/admin/users/create') {
    if (!await requireAdmin(request, response)) return
    try {
      const body = await readBody(request)
      let user = await registerOrUpdateUser({ ...body, status: 'active' }, { trusted: true })
      const openingCoins = Number(body.creditCoins) || 0
      if (openingCoins > 0) {
        user = await adjustUserBalance({ userKey: user.user_key, amount: openingCoins, wallet: 'credit', note: 'Opening balance' })
      }
      sendJson(response, 201, { success: true, user })
    } catch (error) {
      sendJson(response, 400, { message: error instanceof Error ? error.message : 'Could not create user.' })
    }
    return
  }

  if (request.method === 'PATCH' && pathname === '/api/admin/users/status') {
    if (!await requireAdmin(request, response)) return
    try {
      const body = await readBody(request)
      const user = await adminSetUserStatus(body)
      sendJson(response, 200, { success: true, user })
    } catch (error) {
      sendError(response, error, 'Could not update user status.')
    }
    return
  }

  if (request.method === 'POST' && (pathname === '/api/admin/users/balance' || pathname === '/api/admin/users/credit')) {
    if (!await requireAdmin(request, response)) return
    try {
      sendJson(response, 200, { user: await adjustUserBalance(await readBody(request)) })
    } catch (error) {
      sendError(response, error, 'Could not update the balance.')
    }
    return
  }

  if (request.method === 'GET' && pathname === '/api/admin/users/detail') {
    if (!await requireAdmin(request, response)) return
    try {
      sendJson(response, 200, await getAdminUserDetail(request.query?.userKey || urlObj.searchParams.get('userKey')))
    } catch (error) {
      sendError(response, error, 'Could not load the user.')
    }
    return
  }

  if (request.method === 'GET' && pathname === '/api/admin/notifications') {
    if (!await requireAdmin(request, response)) return
    sendJson(response, 200, await getAdminNotifications())
    return
  }

  if (request.method === 'POST' && pathname === '/api/admin/notifications/read') {
    if (!await requireAdmin(request, response)) return
    sendJson(response, 200, await markAdminNotificationsRead(await readBody(request)))
    return
  }

  if (request.method === 'POST' && pathname === '/api/admin/payments/review') {
    if (!await requireAdmin(request, response)) return
    try {
      sendJson(response, 200, await reviewPaymentRequest(await readBody(request)))
    } catch (error) {
      sendError(response, error, 'Could not review the payment.')
    }
    return
  }

  if (request.method === 'POST' && pathname === '/api/admin/withdrawals/review') {
    if (!await requireAdmin(request, response)) return
    try {
      sendJson(response, 200, await reviewWithdrawalRequest(await readBody(request)))
    } catch (error) {
      sendError(response, error, 'Could not review the withdrawal.')
    }
    return
  }

  if (request.method === 'POST' && pathname === '/api/users/wallet') {
    try {
      sendJson(response, 200, await getAuthorizedWallet(await readBody(request)))
    } catch (error) {
      sendError(response, error, 'Could not load the wallet.')
    }
    return
  }

  if (request.method === 'POST' && pathname === '/api/admin/matches/kills') {
    if (!await requireAdmin(request, response)) return
    try {
      await recordMatchKills(await readBody(request))
      sendJson(response, 200, { recorded: true })
    } catch (error) {
      sendJson(response, 400, { message: error instanceof Error ? error.message : 'Could not save kills.' })
    }
    return
  }

  if (request.method === 'POST' && pathname === '/api/payments/request') {
    try {
      const payment = await recordPaymentRequest(await readBody(request))
      sendJson(response, 201, { recorded: true, payment })
    } catch (error) {
      sendError(response, error, 'Could not record payment request.')
    }
    return
  }

  if (request.method === 'POST' && pathname === '/api/matches/entry') {
    try {
      sendJson(response, 201, { recorded: true, ...await recordMatchEntry(await readBody(request)) })
    } catch (error) {
      sendError(response, error, 'Could not record match entry.')
    }
    return
  }

  if (request.method === 'POST' && pathname === '/api/matches/catalog') {
    if (!await requireAdmin(request, response)) return
    try {
      await registerMatchCatalog((await readBody(request)).matches)
      sendJson(response, 201, { recorded: true })
    } catch (error) {
      sendJson(response, 400, { message: error instanceof Error ? error.message : 'Could not record match catalog.' })
    }
    return
  }

  if (request.method === 'GET' && pathname === '/api/matches/catalog') {
    sendJson(response, 200, { matches: await getPublicMatchCatalog() })
    return
  }

  if (request.method === 'POST' && pathname === '/api/withdrawals/request') {
    try {
      sendJson(response, 201, { recorded: true, ...await recordWithdrawalRequest(await readBody(request)) })
    } catch (error) {
      sendError(response, error, 'Could not record withdrawal request.')
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
