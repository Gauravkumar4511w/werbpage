/* global process */
// Phone notifications (Web Push). They need a VAPID key pair in the environment:
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT (a mailto: or https: contact)
// Make one with `npx web-push generate-vapid-keys`. Without them nothing is sent and the app only
// shows its in-app messages.
import webpush from 'web-push'

const publicKey = process.env.VAPID_PUBLIC_KEY || ''
const privateKey = process.env.VAPID_PRIVATE_KEY || ''
const subject = process.env.VAPID_SUBJECT || 'mailto:support@arenacore.app'

export const pushConfigured = Boolean(publicKey && privateKey)
if (pushConfigured) webpush.setVapidDetails(subject, publicKey, privateKey)

export function getPushPublicKey() {
  return pushConfigured ? publicKey : ''
}

// Sends one notification. Returns 'sent', 'gone' (the browser dropped this subscription, so it
// should be deleted) or 'failed'. Tests swap the sender with setPushSender().
let sender = async (subscription, payload) => {
  if (!pushConfigured) return 'failed'
  try {
    await webpush.sendNotification(subscription, payload, { TTL: 60 * 60, urgency: 'high' })
    return 'sent'
  } catch (error) {
    return error?.statusCode === 404 || error?.statusCode === 410 ? 'gone' : 'failed'
  }
}

let customSender = false
export function setPushSender(fn) {
  sender = fn
  customSender = true
}

// Whether sending can do anything: keys are set, or a test sender is in place.
export function pushActive() {
  return pushConfigured || customSender
}

export async function sendPush(subscription, message) {
  return sender(subscription, JSON.stringify(message))
}
