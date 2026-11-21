import { useEffect, useState } from 'react'
import { getPushPublicKey, pushSupported, subscribeToPush } from '../pushNotifications.js'

const dismissedKey = 'arenacore-notify-dismissed'

function wasDismissed() {
  try { return localStorage.getItem(dismissedKey) === '1' } catch { return false }
}

// Asks a signed-in player to turn on phone notifications (coins added, room ready). Shown only when
// this browser can receive them and the server has its keys. Where permission was already given, it
// quietly makes sure this device is subscribed for this player.
function NotifyPrompt({ player, userKey }) {
  const [state, setState] = useState({ show: false, publicKey: '', busy: false, error: '' })

  useEffect(() => {
    if (!player || !pushSupported() || Notification.permission === 'denied') return undefined
    let active = true
    getPushPublicKey().then((publicKey) => {
      if (!active || !publicKey) return
      if (Notification.permission === 'granted') {
        subscribeToPush({ userKey, password: player.password }, publicKey).catch(() => {})
        return
      }
      if (!wasDismissed()) setState((current) => ({ ...current, show: true, publicKey }))
    })
    return () => { active = false }
  }, [player, userKey])

  if (!state.show) return null

  const close = () => {
    try { localStorage.setItem(dismissedKey, '1') } catch { /* private mode */ }
    setState((current) => ({ ...current, show: false }))
  }
  const turnOn = async () => {
    setState((current) => ({ ...current, busy: true, error: '' }))
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        close()
        return
      }
      await subscribeToPush({ userKey, password: player.password }, state.publicKey)
      setState((current) => ({ ...current, show: false, busy: false }))
    } catch (error) {
      setState((current) => ({ ...current, busy: false, error: error.message || 'Could not turn on notifications.' }))
    }
  }

  return (
    <aside className="notify-prompt" role="dialog" aria-label="Turn on notifications">
      <span className="notify-prompt-bell" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 2h-15l1.5-2ZM10 20.5a2 2 0 0 0 4 0" /></svg>
      </span>
      <div>
        <strong>Get notified instantly</strong>
        <small>When coins reach your wallet and when your room ID is ready.</small>
        {state.error && <small className="notify-prompt-error">{state.error}</small>}
      </div>
      <button className="notify-prompt-on" type="button" onClick={turnOn} disabled={state.busy}>{state.busy ? '...' : 'Turn on'}</button>
      <button className="notify-prompt-close" type="button" aria-label="Not now" onClick={close}>×</button>
    </aside>
  )
}

export default NotifyPrompt
