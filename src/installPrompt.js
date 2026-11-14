import { useEffect, useState } from 'react'

// Chrome fires `beforeinstallprompt` once the site qualifies as an installable app.
// We keep the event so our own "Install app" button can open Chrome's install dialog.
let deferredPrompt = null
const listeners = new Set()
const notify = () => listeners.forEach((fn) => fn(Boolean(deferredPrompt)))

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    deferredPrompt = event
    notify()
  })
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null
    notify()
  })
}

export function useInstallPrompt() {
  const [canInstall, setCanInstall] = useState(Boolean(deferredPrompt))

  useEffect(() => {
    listeners.add(setCanInstall)
    return () => listeners.delete(setCanInstall)
  }, [])

  const install = async () => {
    if (!deferredPrompt) return
    const prompt = deferredPrompt
    deferredPrompt = null
    notify()
    await prompt.prompt()
    await prompt.userChoice
  }

  return { canInstall, install }
}
