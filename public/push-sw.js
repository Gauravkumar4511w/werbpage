/* global self, clients */
// Phone notifications, loaded into the app's service worker (see workbox.importScripts in
// vite.config.js). The server sends { title, body, url, tag }.
self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { data = { body: event.data && event.data.text() } }
  event.waitUntil(self.registration.showNotification(data.title || 'ArenaCore', {
    body: data.body || '',
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    tag: data.tag || undefined,
    renotify: Boolean(data.tag),
    data: { url: data.url || '/' },
  }))
})

// Tapping a notification opens the app on its page, reusing a window that is already open.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
    for (const client of windows) {
      if (client.url.startsWith(self.location.origin) && 'focus' in client) {
        if ('navigate' in client) client.navigate(url)
        return client.focus()
      }
    }
    return clients.openWindow(url)
  }))
})
