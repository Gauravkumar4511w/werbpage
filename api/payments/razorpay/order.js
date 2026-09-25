/* global process, Buffer */

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

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    response.status(405).json({ message: 'Method not allowed' })
    return
  }

  if (!hasRazorpayConfig()) {
    response.status(503).json({ message: 'Razorpay is not configured on the server.' })
    return
  }

  try {
    const body = typeof request.body === 'string' ? JSON.parse(request.body || '{}') : request.body || {}
    const coins = Number(body.coins)
    if (!Number.isInteger(coins) || coins < 50) {
      response.status(400).json({ message: 'Buy at least 50 whole coins.' })
      return
    }

    const razorpayResponse = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        Authorization: razorpayAuth(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: coins * 100,
        currency: 'INR',
        receipt: `arenacore-${Date.now()}`,
        notes: { coins: String(coins) },
      }),
    })
    const data = await razorpayResponse.json()
    if (!razorpayResponse.ok) {
      response.status(502).json({ message: data.error?.description || 'Could not create Razorpay order.' })
      return
    }

    response.status(200).json({ orderId: data.id, amount: data.amount, currency: data.currency, coins })
  } catch (error) {
    response.status(502).json({ message: error instanceof Error ? error.message : 'Could not create payment order.' })
  }
}
