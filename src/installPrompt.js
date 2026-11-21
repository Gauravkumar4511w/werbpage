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

// Opens Chrome's install dialog. It lives outside the hook on purpose: inside it, the React
// Compiler turned `const prompt = deferredPrompt` into reads of deferredPrompt after it was set to
// null, so every tap failed with "Cannot read properties of null (reading 'prompt')".
async function openInstallDialog() {
  const prompt = deferredPrompt
  if (!prompt) return
  deferredPrompt = null
  notify()
  await prompt.prompt()
  await prompt.userChoice
}

export function useInstallPrompt() {
  const [canInstall, setCanInstall] = useState(Boolean(deferredPrompt))

  useEffect(() => {
    listeners.add(setCanInstall)
    return () => listeners.delete(setCanInstall)
  }, [])

  return { canInstall, install: openInstallDialog }
}
