import { useEffect, useEffectEvent, useRef, useState } from 'react'

let configRequest = null
let scriptRequest = null

// The client ID comes from the server (GOOGLE_CLIENT_ID), so changing it needs no rebuild.
function loadGoogleClientId() {
  configRequest ??= fetch('/api/auth/config')
    .then((response) => (response.ok ? response.json() : {}))
    .then((config) => config.googleClientId || '')
    .catch(() => {
      configRequest = null
      return ''
    })
  return configRequest
}

function loadGoogleScript() {
  scriptRequest ??= new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.onload = () => resolve(window.google)
    script.onerror = () => {
      scriptRequest = null
      script.remove()
      reject(new Error('Could not load Google sign-in. Check your connection.'))
    }
    document.head.appendChild(script)
  })
  return scriptRequest
}

// Google's own "Sign in with Google" button. It renders nothing until GOOGLE_CLIENT_ID is set.
function GoogleButton({ onCredential, onError }) {
  const container = useRef(null)
  const [clientId, setClientId] = useState('')
  const handleResponse = useEffectEvent((response) => onCredential(response.credential))
  const handleError = useEffectEvent((message) => onError(message))

  useEffect(() => {
    let active = true
    loadGoogleClientId().then((id) => active && setClientId(id))
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!clientId) return undefined
    let active = true
    loadGoogleScript().then((google) => {
      if (!active || !container.current) return
      google.accounts.id.initialize({ client_id: clientId, callback: handleResponse, ux_mode: 'popup' })
      google.accounts.id.renderButton(container.current, {
        theme: 'filled_black',
        size: 'large',
        text: 'continue_with',
        shape: 'rectangular',
        width: Math.min(400, container.current.clientWidth || 340),
      })
    }).catch((error) => active && handleError(error.message))
    return () => { active = false }
  }, [clientId])

  if (!clientId) return null
  return (
    <>
      <div className="google-signin" ref={container} />
      <div className="auth-divider"><span>OR WITH EMAIL</span></div>
    </>
  )
}

export default GoogleButton
