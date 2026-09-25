/* global process, Buffer */
import crypto from 'node:crypto'

function razorpayAuth() {
  return `Basic ${Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64')}`
}

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    response.status(405).json({ message: 'Method not allowed' })
    return
  }

  try {
    const body = typeof request.body === 'string' ? JSON.parse(request.body || '{}') : request.body || {}
    const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = body
    if (!orderId || !paymentId || !signature || !process.env.RAZORPAY_KEY_SECRET) {
      response.status(400).json({ message: 'Incomplete payment verification data.' })
      return
    }

    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${orderId}|${paymentId}`)
      .digest('hex')
    const providedSignature = Buffer.from(signature)
    const calculatedSignature = Buffer.from(expectedSignature)
    if (providedSignature.length !== calculatedSignature.length || !crypto.timingSafeEqual(providedSignature, calculatedSignature)) {
      response.status(400).json({ message: 'Payment signature could not be verified.' })
      return
    }

    const paymentResponse = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}`, {
      headers: { Authorization: razorpayAuth() },
    })
    const payment = await paymentResponse.json()
    if (!paymentResponse.ok || payment.order_id !== orderId || payment.status !== 'captured') {
      response.status(400).json({ message: 'Payment is not captured yet.' })
      return
    }

    const coins = Number(payment.amount) / 100
    if (!Number.isInteger(coins) || coins < 50) {
      response.status(400).json({ message: 'Invalid payment amount.' })
      return
    }

    response.status(200).json({ verified: true, paymentId, coins })
  } catch (error) {
    response.status(502).json({ message: error instanceof Error ? error.message : 'Payment verification failed.' })
  }
}
