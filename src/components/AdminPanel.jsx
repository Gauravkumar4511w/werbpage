import { useEffect, useRef, useState } from 'react'
import AdminUserDetail, { ReviewButtons } from './AdminUserDetail'
import { formatDate, timeAgo, withdrawalDestination } from './adminFormat'

const emptyOverview = { users: [], matches: [], entries: [], payments: [], withdrawals: [], kills: [], notifications: [], unreadNotifications: 0 }
const matchModes = ['Battle Royale Solo', 'Battle Royale Duo', 'Battle Royale Squad', 'Clash Squad 1v1', 'Clash Squad 2v2', 'Clash Squad 4v4', 'Lone Wolf 1v1']
const defaultFees = { 'Battle Royale Solo': 50, 'Battle Royale Duo': 100, 'Battle Royale Squad': 150, 'Clash Squad 1v1': 50, 'Clash Squad 2v2': 100, 'Clash Squad 4v4': 200, 'Lone Wolf 1v1': 75 }
const adminTitle = 'ADMIN DESK · ARENACORE'

// datetime-local inputs show local time; toISOString() is UTC and shifted IST matches by 5.5 hours on save.
function toLocalInputValue(timestamp) {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

function playAlertSound() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext
    if (!AudioContext) return
    const context = new AudioContext()
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.frequency.setValueAtTime(880, context.currentTime)
    oscillator.frequency.setValueAtTime(1320, context.currentTime + 0.12)
    gain.gain.setValueAtTime(0.0001, context.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.2, context.currentTime + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.35)
    oscillator.connect(gain).connect(context.destination)
    oscillator.onended = () => context.close()
    oscillator.start()
    oscillator.stop(context.currentTime + 0.36)
  } catch { /* The alert sound is optional. */ }
}

function showDesktopNotification(notification) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted' || !document.hidden) return
  try {
    new Notification(notification.title, { body: notification.body, tag: `arenacore-${notification.id}` })
  } catch { /* Some mobile browsers only allow notifications from a service worker. */ }
}

function addToasts(setToasts, items) {
  setToasts((current) => [...items, ...current].slice(0, 4))
  for (const item of items) {
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.key !== item.key)), 9000)
  }
}

function AdminPanel({ onBack }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [token, setToken] = useState(() => sessionStorage.getItem('arenacore-admin-token') || '')
  const [overview, setOverview] = useState(emptyOverview)
  const [tab, setTab] = useState('overview')
  const [query, setQuery] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [alertsOpen, setAlertsOpen] = useState(false)
  const [toasts, setToasts] = useState([])
  const [highlight, setHighlight] = useState(null)
  const [reviewFilter, setReviewFilter] = useState('pending')
  const [notificationPermission, setNotificationPermission] = useState(() => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission))
  const [userLookup, setUserLookup] = useState('')
  const [userDetail, setUserDetail] = useState(null)
  const [userForm, setUserForm] = useState({ userKey: '', displayName: '', creditCoins: '' })
  const [killForm, setKillForm] = useState({ matchId: '', userKey: '', kills: '' })
  const [resultForm, setResultForm] = useState({ matchId: '', winnerTeamKey: '' })
  const [matchLookup, setMatchLookup] = useState('')
  const [selectedMatch, setSelectedMatch] = useState(null)
  const [matchForm, setMatchForm] = useState({ entryFee: '', matchTimestamp: '', prizePool: '', description: '', roomId: '', roomPassword: '' })
  const [createForm, setCreateForm] = useState({ mode: matchModes[0], entryFee: String(defaultFees[matchModes[0]]), matchTimestamp: '', prizePool: '', description: '' })
  const lastNotificationId = useRef(null)

  const api = async (url, options = {}) => {
    let response
    try {
      response = await fetch(url, {
        ...options,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) },
      })
    } catch {
      throw new Error('Cannot connect to server. Please check that the server is running.')
    }
    const data = await response.json().catch(() => null)
    if (!data) {
      throw new Error('Admin login service is unavailable. Please try again after the server is restarted.')
    }
    if (!response.ok) {
      if (response.status === 401) {
        sessionStorage.removeItem('arenacore-admin-token')
        setToken('')
        throw new Error(data.message || 'Admin authentication required or invalid credentials.')
      }
      throw new Error(data.message || `Request failed (${response.status}).`)
    }
    return data
  }

  const loadOverview = async () => {
    const data = await api('/api/admin/overview')
    setOverview(data)
    return data
  }

  useEffect(() => {
    if (!token) return undefined
    let active = true
    const refresh = async () => {
      try {
        const response = await fetch('/api/admin/overview', { headers: { Authorization: `Bearer ${token}` } })
        if (response.status === 401) {
          if (active) {
            sessionStorage.removeItem('arenacore-admin-token')
            setToken('')
            setMessage('Session expired. Please log in again.')
          }
          return
        }
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data.message || 'Request failed.')
        if (!active) return
        setOverview(data)

        // Alert on every notification newer than the ones already seen in this tab.
        const notifications = data.notifications || []
        const newestId = notifications[0]?.id || 0
        if (lastNotificationId.current === null) {
          lastNotificationId.current = newestId
          if (data.unreadNotifications > 0) {
            addToasts(setToasts, [{ key: 'unread', type: 'info', title: `${data.unreadNotifications} unread alert${data.unreadNotifications === 1 ? '' : 's'}`, body: 'Open Alerts to review top-ups and withdrawals.' }])
          }
        } else if (newestId > lastNotificationId.current) {
          const fresh = notifications.filter((item) => item.id > lastNotificationId.current)
          lastNotificationId.current = newestId
          addToasts(setToasts, fresh.map((item) => ({ ...item, key: `n-${item.id}` })))
          fresh.forEach(showDesktopNotification)
          playAlertSound()
        }
      } catch (error) {
        if (active) setMessage(error.message)
      }
    }
    refresh()
    const timer = window.setInterval(refresh, 5000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [token])

  const unread = token ? overview.unreadNotifications || 0 : 0
  useEffect(() => {
    const previousTitle = document.title
    document.title = unread ? `(${unread}) ${adminTitle}` : adminTitle
    return () => { document.title = previousTitle }
  }, [unread])

  const login = async (event) => {
    event.preventDefault()
    setLoading(true)
    setMessage('')
    try {
      const data = await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ email: email.trim(), password }) })
      if (typeof data.token !== 'string' || !data.token) throw new Error('Invalid login response from server.')
      sessionStorage.setItem('arenacore-admin-token', data.token)
      lastNotificationId.current = null
      setToken(data.token)
      setMessage('Admin dashboard ready.')
    } catch (error) {
      setMessage(error.message)
    } finally {
      setLoading(false)
    }
  }

  const loadUser = async (key, { quiet = false } = {}) => {
    const value = String(key || '').trim()
    if (!value) {
      setMessage('Enter a user key, email, phone or gamer tag.')
      return
    }
    try {
      const data = await api(`/api/admin/users/detail?userKey=${encodeURIComponent(value)}`)
      setUserDetail(data)
      setUserLookup(data.user.user_key)
      if (!quiet) setMessage(`Showing ${data.user.display_name || data.user.user_key}.`)
    } catch (error) {
      if (!quiet) setUserDetail(null)
      setMessage(error.message)
    }
  }

  const openUser = (key) => {
    setTab('users')
    setAlertsOpen(false)
    loadUser(key)
  }

  const refreshAfterChange = async (userKey) => {
    await loadOverview()
    if (userDetail && userDetail.user.user_key === userKey) await loadUser(userKey, { quiet: true })
  }

  const runAction = async (work) => {
    setBusy(true)
    try {
      return await work()
    } catch (error) {
      setMessage(error.message)
      return false
    } finally {
      setBusy(false)
    }
  }

  const reviewPayment = async (row, decision) => {
    let note = ''
    if (decision === 'approve') {
      if (!window.confirm(`Approve ${row.coins.toLocaleString()} coins for ${row.user_key}?\n\nOnly approve after you find UTR ${row.utr} for ₹${row.amount.toLocaleString()} in your UPI / bank statement.`)) return
    } else {
      const reason = window.prompt(`Reject top-up #${row.id} (UTR ${row.utr})?\nReason shown to the player:`, 'Payment not received')
      if (reason === null) return
      note = reason
    }
    await runAction(async () => {
      const data = await api('/api/admin/payments/review', { method: 'POST', body: JSON.stringify({ id: row.id, decision, note }) })
      setMessage(decision === 'approve'
        ? `Approved: ${row.coins.toLocaleString()} coins added to ${row.user_key}. Credit balance is now ${data.user.credit_coins.toLocaleString()}.`
        : `Top-up #${row.id} from ${row.user_key} rejected.`)
      await refreshAfterChange(row.user_key)
    })
  }

  const reviewWithdrawal = async (row, decision) => {
    let note = ''
    if (decision === 'approve') {
      if (!window.confirm(`Mark withdrawal #${row.id} as paid?\n\nSend ₹${row.amount.toLocaleString()} to ${withdrawalDestination(row)} first.`)) return
    } else {
      const reason = window.prompt(`Reject withdrawal #${row.id}? ${row.amount.toLocaleString()} winning coins go back to ${row.user_key}.\nReason shown to the player:`, 'Payment details are invalid')
      if (reason === null) return
      note = reason
    }
    await runAction(async () => {
      await api('/api/admin/withdrawals/review', { method: 'POST', body: JSON.stringify({ id: row.id, decision, note }) })
      setMessage(decision === 'approve' ? `Withdrawal #${row.id} marked as paid.` : `Withdrawal #${row.id} rejected and ${row.amount.toLocaleString()} coins refunded.`)
      await refreshAfterChange(row.user_key)
    })
  }

  const adjustBalance = ({ wallet, amount, note }) => runAction(async () => {
    const userKey = userDetail.user.user_key
    const data = await api('/api/admin/users/balance', { method: 'POST', body: JSON.stringify({ userKey, wallet, amount, note }) })
    setMessage(`${amount > 0 ? 'Added' : 'Deducted'} ${Math.abs(amount).toLocaleString()} ${wallet} coins ${amount > 0 ? 'to' : 'from'} ${userKey}. Total balance is now ${(data.user.credit_coins + data.user.winning_coins).toLocaleString()}.`)
    await Promise.all([loadUser(userKey, { quiet: true }), loadOverview()])
    return true
  })

  const setUserStatus = (status) => runAction(async () => {
    const userKey = userDetail.user.user_key
    await api('/api/admin/users/status', { method: 'PATCH', body: JSON.stringify({ userKey, status }) })
    setMessage(`${userKey} is now ${status}.`)
    await Promise.all([loadUser(userKey, { quiet: true }), loadOverview()])
  })

  const markNotificationsRead = async (ids) => {
    try {
      const data = await api('/api/admin/notifications/read', { method: 'POST', body: JSON.stringify(ids ? { ids } : {}) })
      setOverview((current) => ({ ...current, ...data }))
    } catch (error) { setMessage(error.message) }
  }

  const openNotification = (item) => {
    if (!item.read_at) markNotificationsRead([item.id])
    setAlertsOpen(false)
    setToasts((current) => current.filter((toast) => toast.key !== item.key))
    if (item.type === 'payment' || item.type === 'withdrawal') {
      const nextTab = item.type === 'payment' ? 'payments' : 'withdrawals'
      setTab(nextTab)
      setReviewFilter('all')
      setQuery('')
      setHighlight({ type: item.type, id: item.reference_id })
      window.setTimeout(() => document.getElementById(`${item.type}-${item.reference_id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50)
    } else if (item.user_key) {
      openUser(item.user_key)
    }
  }

  const enableDesktopAlerts = async () => {
    if (typeof Notification === 'undefined') return
    setNotificationPermission(await Notification.requestPermission())
  }

  const submitCreateUser = async (event) => {
    event.preventDefault()
    try {
      const data = await api('/api/admin/users/create', {
        method: 'POST',
        body: JSON.stringify({
          userKey: userForm.userKey.trim(),
          displayName: userForm.displayName.trim(),
          creditCoins: Number(userForm.creditCoins) || 0,
        }),
      })
      setUserForm({ userKey: '', displayName: '', creditCoins: '' })
      setMessage(`Active user ${data.user?.display_name || data.user?.user_key || userForm.userKey} added and counted.`)
      await loadOverview()
    } catch (error) { setMessage(error.message) }
  }

  const submitKills = async (event) => {
    event.preventDefault()
    try {
      await api('/api/admin/matches/kills', { method: 'POST', body: JSON.stringify({ matchId: killForm.matchId, kills: [{ userKey: killForm.userKey, kills: Number(killForm.kills) }] }) })
      setKillForm({ matchId: '', userKey: '', kills: '' })
      setMessage('Kill count saved.')
      await loadOverview()
    } catch (error) { setMessage(error.message) }
  }

  const submitResult = async (event) => {
    event.preventDefault()
    try {
      const data = await api('/api/admin/matches/confirm-result', { method: 'POST', body: JSON.stringify(resultForm) })
      setResultForm({ matchId: '', winnerTeamKey: '' })
      setMessage(`Result confirmed. ${data.payout.payoutPool} winning coins distributed.`)
      await loadOverview()
    } catch (error) { setMessage(error.message) }
  }

  const selectMatch = (value) => {
    const normalized = value.trim().replace(/^#/, '').toLowerCase()
    const match = overview.matches.find((item) => item.public_id === normalized || item.match_id.toLowerCase() === value.trim().toLowerCase())
    if (!match) {
      setMessage('Match not found. Check the unique ID.')
      setSelectedMatch(null)
      return
    }
    setSelectedMatch(match)
    setMatchLookup(match.public_id ? `#${match.public_id}` : match.match_id)
    setMatchForm({
      entryFee: String(match.entry_fee),
      matchTimestamp: toLocalInputValue(match.match_timestamp),
      prizePool: match.prize_pool === null ? '' : String(match.prize_pool),
      description: match.description || '',
      roomId: match.room_id || '',
      roomPassword: match.room_password || '',
    })
    setMessage('Match details loaded.')
  }

  const submitMatchUpdate = async (event) => {
    event.preventDefault()
    if (!selectedMatch) return
    try {
      await api('/api/admin/matches/update', {
        method: 'PATCH',
        body: JSON.stringify({
          publicId: selectedMatch.public_id,
          entryFee: Number(matchForm.entryFee),
          matchTimestamp: matchForm.matchTimestamp ? new Date(matchForm.matchTimestamp).getTime() : '',
          prizePool: matchForm.prizePool === '' ? '' : Number(matchForm.prizePool),
          description: matchForm.description,
          roomId: matchForm.roomId,
          roomPassword: matchForm.roomPassword,
        }),
      })
      setMessage('Match settings updated. Players will see the changes on their next refresh.')
      const freshOverview = await loadOverview()
      const updatedMatch = freshOverview.matches.find((match) => match.match_id === selectedMatch.match_id)
      if (updatedMatch) {
        setSelectedMatch(updatedMatch)
        setMatchForm({
          entryFee: String(updatedMatch.entry_fee),
          matchTimestamp: toLocalInputValue(updatedMatch.match_timestamp),
          prizePool: updatedMatch.prize_pool === null ? '' : String(updatedMatch.prize_pool),
          description: updatedMatch.description || '',
          roomId: updatedMatch.room_id || '',
          roomPassword: updatedMatch.room_password || '',
        })
      }
    } catch (error) { setMessage(error.message) }
  }

  const submitCreateMatch = async (event) => {
    event.preventDefault()
    try {
      const data = await api('/api/admin/matches/create', {
        method: 'POST',
        body: JSON.stringify({
          ...createForm,
          entryFee: Number(createForm.entryFee),
          matchTimestamp: new Date(createForm.matchTimestamp).getTime(),
          prizePool: createForm.prizePool === '' ? null : Number(createForm.prizePool),
        }),
      })
      setMessage(`Match #${data.match.public_id} created.`)
      setCreateForm({ mode: matchModes[0], entryFee: String(defaultFees[matchModes[0]]), matchTimestamp: '', prizePool: '', description: '' })
      await loadOverview()
    } catch (error) { setMessage(error.message) }
  }

  const deleteSelectedMatch = async () => {
    if (!selectedMatch || !window.confirm(`Delete match #${selectedMatch.public_id}? Entry fees are refunded to every joined player.`)) return
    try {
      const data = await api('/api/admin/matches/delete', { method: 'DELETE', body: JSON.stringify({ matchId: selectedMatch.public_id }) })
      setSelectedMatch(null)
      setMessage(`Match #${selectedMatch.public_id} deleted.${data.refunds ? ' Entry fees refunded.' : ''}`)
      await loadOverview()
    } catch (error) { setMessage(error.message) }
  }

  if (!token) {
    return (
      <main className="admin-page">
        <button className="library-back" type="button" onClick={onBack}>&lt;- Back to discover</button>
        <section className="admin-login">
          <p className="eyebrow"><span /> Secure control room</p>
          <h1>ADMIN ACCESS.</h1>
          <p>Review payments, matches, winnings and withdrawals.</p>
          <form onSubmit={login}>
            <label>Admin email
              <input
                type="text"
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="gaurav7744@gmail.com or admin"
                required
              />
            </label>
            <label>Password
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Admin password"
                required
              />
            </label>
            <button className="auth-submit" type="submit" disabled={loading}>
              {loading ? 'Signing in...' : <>Open dashboard <span>-&gt;</span></>}
            </button>
          </form>
          {message && <p className="admin-message">{message}</p>}
        </section>
      </main>
    )
  }

  const searchable = (value) => JSON.stringify(value).toLowerCase().includes(query.toLowerCase())
  const logout = () => { sessionStorage.removeItem('arenacore-admin-token'); setToken(''); setUserDetail(null) }
  const filteredUsers = overview.users.filter(searchable)
  const usersDisplayRows = filteredUsers.map((item) => ({
    ...item,
    status: item.status || 'active',
    online: item.is_online ? 'Online' : 'Offline',
  }))
  const byPendingFirst = (a, b) => (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1) || b.id - a.id
  const pendingPayments = overview.payments.filter((item) => item.status === 'pending')
  const pendingWithdrawals = overview.withdrawals.filter((item) => item.status === 'pending')
  const filteredPayments = overview.payments.filter((item) => (reviewFilter === 'all' || item.status === 'pending') && searchable(item)).sort(byPendingFirst)
  const filteredWithdrawals = overview.withdrawals.filter((item) => (reviewFilter === 'all' || item.status === 'pending') && searchable(item)).sort(byPendingFirst)
  const filteredMatches = overview.matches.filter(searchable)
  const currentSelectedMatch = selectedMatch
    ? overview.matches.find((match) => match.match_id === selectedMatch.match_id) || selectedMatch
    : null
  const notifications = overview.notifications || []

  const userLookupCard = (
    <section className="admin-card admin-user-lookup">
      <h2>Find a user</h2>
      <p>Enter the user key (email or phone), or the player&apos;s gamer tag, to see balances and history and to add or deduct coins.</p>
      <form className="admin-lookup-row" onSubmit={(event) => { event.preventDefault(); openUser(userLookup) }}>
        <input value={userLookup} onChange={(event) => setUserLookup(event.target.value)} placeholder="player@gmail.com / 9876543210 / GamerTag" list="admin-user-keys" />
        <datalist id="admin-user-keys">{overview.users.slice(0, 200).map((user) => <option key={user.user_key} value={user.user_key}>{user.display_name}</option>)}</datalist>
        <button type="submit" disabled={busy}>Open user</button>
      </form>
    </section>
  )

  return (
    <main className="admin-page">
      <header className="admin-header">
        <div><p className="eyebrow"><span /> Secure control room</p><h1>ADMIN DESK.</h1></div>
        <div className="admin-header-actions">
          <div className="admin-alerts">
            <button type="button" className={`admin-bell ${unread ? 'has-unread' : ''}`} onClick={() => setAlertsOpen(!alertsOpen)} aria-expanded={alertsOpen} aria-label={`Alerts, ${unread} unread`}>
              Alerts{unread > 0 && <span className="admin-badge">{unread > 99 ? '99+' : unread}</span>}
            </button>
            {alertsOpen && (
              <div className="admin-alert-panel" role="dialog" aria-label="Notifications">
                <div className="admin-alert-head">
                  <strong>Notifications</strong>
                  <div>
                    {notificationPermission === 'default' && <button type="button" onClick={enableDesktopAlerts}>Enable desktop alerts</button>}
                    {unread > 0 && <button type="button" onClick={() => markNotificationsRead()}>Mark all read</button>}
                  </div>
                </div>
                {notificationPermission === 'denied' && <p className="admin-alert-hint">Desktop alerts are blocked in this browser. In-page alerts and sound still work.</p>}
                <ul>
                  {notifications.length ? notifications.map((item) => (
                    <li key={item.id}>
                      <button type="button" className={item.read_at ? '' : 'is-unread'} onClick={() => openNotification(item)}>
                        <span className={`admin-alert-type is-${item.type}`}>{item.type === 'payment' ? 'Top-up' : item.type}</span>
                        <strong>{item.title}</strong>
                        <small>{item.body}</small>
                        <time>{timeAgo(item.created_at)}</time>
                      </button>
                    </li>
                  )) : <li className="admin-alert-empty">No notifications yet. You will be alerted here when a player submits a UTR or asks to withdraw.</li>}
                </ul>
              </div>
            )}
          </div>
          <button type="button" onClick={() => loadOverview().catch((error) => setMessage(error.message))}>Refresh</button>
          <button type="button" onClick={logout}>Sign out</button>
          <button type="button" onClick={onBack}>Exit</button>
        </div>
      </header>

      {toasts.length > 0 && (
        <div className="admin-toasts" aria-live="polite">
          {toasts.map((toast) => (
            <div key={toast.key} className={`admin-toast is-${toast.type}`}>
              <button type="button" onClick={() => (toast.id ? openNotification(toast) : setAlertsOpen(true))}>
                <strong>{toast.title}</strong>
                <span>{toast.body}</span>
              </button>
              <button type="button" className="admin-toast-close" aria-label="Dismiss" onClick={() => setToasts((current) => current.filter((item) => item.key !== toast.key))}>×</button>
            </div>
          ))}
        </div>
      )}

      <div className="admin-summary">
        <div><span>Total Users</span><strong>{overview.users.length}</strong></div>
        <div><span>Active Users</span><strong>{overview.activeUsersCount ?? overview.users.filter((item) => item.status !== 'inactive').length}</strong><small>{overview.onlineUsersCount ?? overview.users.filter((item) => item.is_online).length} online now</small></div>
        <div><span>Live Players</span><strong>{overview.liveCount ?? Math.max(overview.users.length, 1)}</strong><small>real-time active</small></div>
        <button type="button" className={pendingPayments.length ? 'needs-review' : ''} onClick={() => { setTab('payments'); setReviewFilter('pending') }}><span>Top-ups</span><strong>{pendingPayments.length}</strong><small>pending review</small></button>
        <button type="button" className={pendingWithdrawals.length ? 'needs-review' : ''} onClick={() => { setTab('withdrawals'); setReviewFilter('pending') }}><span>Withdrawals</span><strong>{pendingWithdrawals.length}</strong><small>pending review</small></button>
        <div><span>Matches</span><strong>{overview.matches.length}</strong></div>
      </div>

      <div className="admin-toolbar">
        <nav>
          {['overview', 'payments', 'withdrawals', 'matches', 'users'].map((item) => (
            <button key={item} className={tab === item ? 'selected' : ''} type="button" onClick={() => setTab(item)}>
              {item}
              {item === 'payments' && pendingPayments.length > 0 && <span className="admin-tab-count">{pendingPayments.length}</span>}
              {item === 'withdrawals' && pendingWithdrawals.length > 0 && <span className="admin-tab-count">{pendingWithdrawals.length}</span>}
            </button>
          ))}
        </nav>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search user, match, UTR..." />
      </div>
      {message && <p className="admin-message" role="status">{message}</p>}

      {tab === 'overview' && <>
        <PaymentReviewTable title="Top-ups waiting for verification" rows={pendingPayments} busy={busy} highlight={highlight} onReview={reviewPayment} onOpenUser={openUser} emptyText="No top-ups are waiting. New UTR submissions appear here and in Alerts." />
        <div className="admin-grid">
          {userLookupCard}
          <section className="admin-card"><h2>Add active user</h2><p>Register a new active player directly into the database.</p><form onSubmit={submitCreateUser}><input placeholder="User email / phone" value={userForm.userKey} onChange={(event) => setUserForm({ ...userForm, userKey: event.target.value })} required /><input placeholder="Display name / Gamer tag" value={userForm.displayName} onChange={(event) => setUserForm({ ...userForm, displayName: event.target.value })} required /><input type="number" min="0" placeholder="Opening credit coins (optional)" value={userForm.creditCoins} onChange={(event) => setUserForm({ ...userForm, creditCoins: event.target.value })} /><button type="submit">Add active user</button></form></section>
          <section className="admin-card"><h2>Record kills</h2><p>Save the final kill count before confirming a result.</p><form onSubmit={submitKills}><input placeholder="Match ID" value={killForm.matchId} onChange={(event) => setKillForm({ ...killForm, matchId: event.target.value })} required /><input placeholder="User email / phone" value={killForm.userKey} onChange={(event) => setKillForm({ ...killForm, userKey: event.target.value })} required /><input type="number" min="0" placeholder="Kills" value={killForm.kills} onChange={(event) => setKillForm({ ...killForm, kills: event.target.value })} required /><button type="submit">Save kills</button></form></section>
          <section className="admin-card"><h2>Confirm winner</h2><p>Once confirmed, the 80% winnings payout cannot be duplicated.</p><form onSubmit={submitResult}><input placeholder="Match ID" value={resultForm.matchId} onChange={(event) => setResultForm({ ...resultForm, matchId: event.target.value })} required /><input placeholder="Winning team key" value={resultForm.winnerTeamKey} onChange={(event) => setResultForm({ ...resultForm, winnerTeamKey: event.target.value })} required /><button type="submit">Confirm result and payout</button></form></section>
        </div>
      </>}

      {(tab === 'payments' || tab === 'withdrawals') && (
        <div className="admin-filter-row">
          {[['pending', 'Pending'], ['all', 'All requests']].map(([value, label]) => (
            <button key={value} type="button" className={reviewFilter === value ? 'selected' : ''} onClick={() => setReviewFilter(value)}>{label}</button>
          ))}
        </div>
      )}
      {tab === 'payments' && <PaymentReviewTable title="Coin top-up requests" rows={filteredPayments} busy={busy} highlight={highlight} onReview={reviewPayment} onOpenUser={openUser} emptyText={reviewFilter === 'pending' ? 'No pending top-ups.' : 'No top-up requests found.'} />}
      {tab === 'withdrawals' && <WithdrawalReviewTable rows={filteredWithdrawals} busy={busy} highlight={highlight} onReview={reviewWithdrawal} onOpenUser={openUser} />}

      {tab === 'matches' && <>
        <section className="admin-card admin-create-match"><h2>Create new match</h2><p>Select any available mode, choose its time, and publish a custom prize.</p><form className="admin-create-form" onSubmit={submitCreateMatch}><label>Mode<select value={createForm.mode} onChange={(event) => setCreateForm({ ...createForm, mode: event.target.value, entryFee: String(defaultFees[event.target.value]) })}>{matchModes.map((mode) => <option key={mode} value={mode}>{mode}</option>)}</select></label><label>Entry fee<input type="number" min="1" value={createForm.entryFee} onChange={(event) => setCreateForm({ ...createForm, entryFee: event.target.value })} required /></label><label>Date and time<input type="datetime-local" value={createForm.matchTimestamp} onChange={(event) => setCreateForm({ ...createForm, matchTimestamp: event.target.value })} required /></label><label>Prize pool<input type="number" min="0" value={createForm.prizePool} onChange={(event) => setCreateForm({ ...createForm, prizePool: event.target.value })} placeholder="Optional" /></label><label>Description<textarea value={createForm.description} onChange={(event) => setCreateForm({ ...createForm, description: event.target.value })} placeholder="Per kill 20 Rs..." rows="3" /></label><button type="submit">Create match</button></form></section>
        <section className="admin-card admin-match-lookup"><h2>Match control</h2><p>Enter a public ID such as #000001 to inspect players and edit settings.</p><div className="admin-lookup-row"><input value={matchLookup} onChange={(event) => setMatchLookup(event.target.value)} placeholder="#000001" /><button type="button" onClick={() => selectMatch(matchLookup)}>Open match</button></div></section>
        {currentSelectedMatch && <MatchControl match={currentSelectedMatch} entries={overview.entries.filter((entry) => entry.match_id === currentSelectedMatch.match_id)} kills={overview.kills.filter((item) => item.match_id === currentSelectedMatch.match_id)} form={matchForm} setForm={setMatchForm} onSubmit={submitMatchUpdate} onDelete={deleteSelectedMatch} />}
        <DataTable title="Registered matches" columns={['public_id', 'mode', 'entry_fee', 'team_count', 'match_timestamp', 'prize_pool', 'status', 'winner_team_key']} rows={filteredMatches} onRowClick={(row) => selectMatch(row.public_id || row.match_id)} />
      </>}

      {tab === 'users' && <>
        {userLookupCard}
        {userDetail && (
          <AdminUserDetail
            key={userDetail.user.user_key}
            detail={userDetail}
            busy={busy}
            onAdjust={adjustBalance}
            onSetStatus={setUserStatus}
            onRefresh={() => loadUser(userDetail.user.user_key)}
            onClose={() => setUserDetail(null)}
            onReviewPayment={reviewPayment}
            onReviewWithdrawal={reviewWithdrawal}
          />
        )}
        <DataTable title="User balances · click a row to open" columns={['user_key', 'display_name', 'status', 'online', 'credit_coins', 'winning_coins', 'created_at']} rows={usersDisplayRows} onRowClick={(row) => loadUser(row.user_key)} />
      </>}
    </main>
  )
}

function PaymentReviewTable({ title, rows, busy, highlight, onReview, onOpenUser, emptyText }) {
  return (
    <section className="admin-table-card admin-review-card">
      <div className="admin-card-heading"><h2>{title}</h2><span>{rows.length} records</span></div>
      <div className="admin-table-wrap">
        <table>
          <thead><tr><th>ID</th><th>User</th><th>Coins</th><th>Paid ₹</th><th>UTR</th><th>Status</th><th>Submitted</th><th>Action</th></tr></thead>
          <tbody>
            {rows.length ? rows.map((row) => (
              <tr key={row.id} id={`payment-${row.id}`} className={highlight?.type === 'payment' && highlight.id === row.id ? 'is-highlighted' : ''}>
                <td>#{row.id}</td>
                <td><button type="button" className="admin-user-link" onClick={() => onOpenUser(row.user_key)}>{row.user_key}</button></td>
                <td>{row.coins.toLocaleString()}</td>
                <td>{row.amount.toLocaleString()}</td>
                <td><code className="admin-utr">{row.utr || '-'}</code>{row.utr && <CopyButton value={row.utr} />}</td>
                <td><span className={`admin-status is-${row.status}`} title={row.review_note || undefined}>{row.status}</span></td>
                <td>{formatDate(row.created_at)}</td>
                <td>{row.status === 'pending' ? <ReviewButtons busy={busy} onApprove={() => onReview(row, 'approve')} onReject={() => onReview(row, 'reject')} /> : <small>{formatDate(row.reviewed_at)}{row.review_note ? ` · ${row.review_note}` : ''}</small>}</td>
              </tr>
            )) : <tr><td colSpan="8">{emptyText}</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function WithdrawalReviewTable({ rows, busy, highlight, onReview, onOpenUser }) {
  return (
    <section className="admin-table-card admin-review-card">
      <div className="admin-card-heading"><h2>Withdrawal requests</h2><span>{rows.length} records</span></div>
      <div className="admin-table-wrap">
        <table>
          <thead><tr><th>ID</th><th>User</th><th>Coins</th><th>Method</th><th>Pay to</th><th>Status</th><th>Requested</th><th>Action</th></tr></thead>
          <tbody>
            {rows.length ? rows.map((row) => (
              <tr key={row.id} id={`withdrawal-${row.id}`} className={highlight?.type === 'withdrawal' && highlight.id === row.id ? 'is-highlighted' : ''}>
                <td>#{row.id}</td>
                <td><button type="button" className="admin-user-link" onClick={() => onOpenUser(row.user_key)}>{row.user_key}</button></td>
                <td>{row.amount.toLocaleString()}</td>
                <td>{row.method.toUpperCase()}</td>
                <td><code className="admin-utr">{withdrawalDestination(row)}</code></td>
                <td><span className={`admin-status is-${row.status}`} title={row.review_note || undefined}>{row.status}</span></td>
                <td>{formatDate(row.created_at)}</td>
                <td>{row.status === 'pending' ? <ReviewButtons busy={busy} approveLabel="Mark paid" onApprove={() => onReview(row, 'approve')} onReject={() => onReview(row, 'reject')} /> : <small>{formatDate(row.reviewed_at)}{row.review_note ? ` · ${row.review_note}` : ''}</small>}</td>
              </tr>
            )) : <tr><td colSpan="8">No withdrawal requests found.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function CopyButton({ value }) {
  const [copied, setCopied] = useState(false)
  return (
    <button type="button" className="admin-copy" onClick={() => navigator.clipboard?.writeText(value).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500) })}>
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

function MatchControl({ match, entries, kills, form, setForm, onSubmit, onDelete }) {
  return <section className="admin-match-control"><div className="admin-card-heading"><div><h2>#{match.public_id || '------'} · {match.mode || 'Match'}</h2><span>{match.status} · {entries.length} joined players</span></div><button className="admin-delete-button" type="button" onClick={onDelete}>Delete match</button></div><div className="admin-match-columns"><div><h3>Joined players</h3><div className="admin-player-list">{entries.length ? entries.map((entry) => <div key={`${entry.team_key}-${entry.user_key}`}><strong>{entry.team_key}</strong><span>{entry.identifiers?.length ? entry.identifiers.join(', ') : entry.user_key}</span><small>{kills.find((item) => item.user_key === entry.user_key)?.kills || 0} kills</small></div>) : <p>No players recorded.</p>}</div></div><form className="admin-match-form" onSubmit={onSubmit}><label>Entry fee<input type="number" min="1" value={form.entryFee} onChange={(event) => setForm({ ...form, entryFee: event.target.value })} required /></label><label>Match time<input type="datetime-local" value={form.matchTimestamp} onChange={(event) => setForm({ ...form, matchTimestamp: event.target.value })} /></label><label>Prize payout override<input type="number" min="0" value={form.prizePool} onChange={(event) => setForm({ ...form, prizePool: event.target.value })} placeholder="Default: 80% pool" /></label><label>Match description<textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Per kill 20 Rs... or Prize pool 40 Rs..." rows="4" /></label><label>Room ID<input value={form.roomId} onChange={(event) => setForm({ ...form, roomId: event.target.value })} placeholder="Shown to joined players 10 min before start" maxLength={40} /></label><label>Room password<input value={form.roomPassword} onChange={(event) => setForm({ ...form, roomPassword: event.target.value })} placeholder="Room password" maxLength={40} /></label><button type="submit">Save match changes</button></form></div></section>
}

function DataTable({ title, columns, rows, onRowClick }) {
  return <section className="admin-table-card"><div className="admin-card-heading"><h2>{title}</h2><span>{rows.length} records</span></div><div className="admin-table-wrap"><table><thead><tr>{columns.map((column) => <th key={column}>{column.replaceAll('_', ' ')}</th>)}</tr></thead><tbody>{rows.length ? rows.map((row, index) => <tr key={`${row.id || row.match_id || row.user_key}-${index}`} className={onRowClick ? 'is-clickable' : ''} onClick={() => onRowClick?.(row)}>{columns.map((column) => <td key={column}>{String(row[column] ?? '-')}</td>)}</tr>) : <tr><td colSpan={columns.length}>No records found.</td></tr>}</tbody></table></div></section>
}

export default AdminPanel
