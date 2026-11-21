// Turning on phone notifications for this device: the browser subscribes with the server's public
// key, and the server stores the subscription for the signed-in player.

export function pushSupported() {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

export async function getPushPublicKey() {
  try {
    const response = await fetch('/api/push/public-key')
    if (!response.ok) return ''
    return (await response.json()).publicKey || ''
  } catch {
    return ''
  }
}

function keyToBytes(base64) {
  const padded = `${base64}${'='.repeat((4 - (base64.length % 4)) % 4)}`.replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0))
}

// The service worker is registered on page load; on a slow first visit it may not be ready yet.
function readyRegistration(timeoutMs = 10000) {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, reject) => window.setTimeout(() => reject(new Error('The app is still loading. Try again in a moment.')), timeoutMs)),
  ])
}

// Subscribes this device (permission must already be granted) and saves it for the player.
export async function subscribeToPush(player, publicKey) {
  const registration = await readyRegistration()
  let subscription = await registration.pushManager.getSubscription()
  if (!subscription) subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(publicKey) })
  const response = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userKey: player.userKey, password: player.password, subscription: subscription.toJSON() }),
  })
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).message || 'Could not turn on notifications.')
}
