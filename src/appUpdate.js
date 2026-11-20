// The service worker keeps a copy of the site for offline use, so an open tab or the installed app
// keeps showing the old version after a deploy until it is fully closed. This swaps in the new version:
// the page reloads once the new service worker takes over, at a moment that loses nothing.

const FRESH_LOAD_MS = 30 * 1000
const UPDATE_CHECK_GAP_MS = 60 * 1000
const loadedAt = Date.now()

// Something typed into a form (in-game names, a UID, an amount) would be lost by a reload.
function hasTypedInput() {
  return [...document.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]), textarea')]
    .some((field) => field.value && field.offsetParent !== null)
}

export function setupAppUpdates() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return

  // With no controller this is the first visit; the service worker taking over then changes nothing.
  const hadController = Boolean(navigator.serviceWorker.controller)
  let pending = false
  let reloading = false

  const reloadIfSafe = () => {
    if (!pending || reloading || hasTypedInput()) return
    reloading = true
    window.location.reload()
  }

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return
    pending = true
    // Just opened: the player has not started anything yet, so show the new version straight away.
    if (Date.now() - loadedAt < FRESH_LOAD_MS || document.visibilityState === 'hidden') reloadIfSafe()
  })

  // Otherwise wait for the player to come back to the app or move to another page.
  window.addEventListener('hashchange', reloadIfSafe)

  let lastCheck = 0
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return
    reloadIfSafe()
    // An installed app resumes from the background without loading, so look for a new version here.
    if (Date.now() - lastCheck < UPDATE_CHECK_GAP_MS) return
    lastCheck = Date.now()
    navigator.serviceWorker.getRegistration().then((registration) => registration?.update()).catch(() => {})
  })
}
