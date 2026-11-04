import { useEffect, useRef, useState } from 'react'
import AdminUserDetail, { ReviewButtons } from './AdminUserDetail'
import { formatDate, formatDay, formatTime, timeAgo, withdrawalDestination } from './adminFormat'
import ScreenshotButton from './ScreenshotButton'
import { formatMatchLabel, formatMatchNo, getIndiaDate, getMatchCapacity, pickByMatchNo } from '../../lib/match-schedule.js'

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
  // The screenshot open in the viewer: { title, dataUrl } once loaded, or { title, error }.
  const [screenshot, setScreenshot] = useState(null)
  const [reviewFilter, setReviewFilter] = useState('pending')
  const [notificationPermission, setNotificationPermission] = useState(() => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission))
  const [userLookup, setUserLookup] = useState('')
  const [userDetail, setUserDetail] = useState(null)
  const [userForm, setUserForm] = useState({ userKey: '', displayName: '', password: '', creditCoins: '' })
  const [killForm, setKillForm] = useState({ matchId: '', userKey: '', kills: '' })
  const [resultForm, setResultForm] = useState({ matchId: '', winnerTeamNo: '' })
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
      if (!quiet) {
        setMessage(`Showing ${data.user.display_name || data.user.user_key}.`)
        // The details open above the users list, so bring them into view after a tap further down.
        window.setTimeout(() => document.querySelector('.admin-user-detail')?.scrollIntoView({ block: 'start' }), 50)
      }
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

  const viewUpload = async (kind, id, title) => {
    setScreenshot({ title })
    try {
      const data = await api(`/api/admin/uploads?kind=${kind}&id=${id}`)
      setScreenshot({ title, dataUrl: data.dataUrl, uploadedAt: data.uploadedAt })
    } catch (error) {
      setScreenshot({ title, error: error.message })
    }
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
          password: userForm.password,
          creditCoins: Number(userForm.creditCoins) || 0,
        }),
      })
      setUserForm({ userKey: '', displayName: '', password: '', creditCoins: '' })
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

  // "#05" is the match 5 that starts closest to now; internal ids and old six-digit ids work too.
  const findMatchById = (value) => {
    const text = String(value || '').trim()
    return pickByMatchNo(overview.matches, text)
      || overview.matches.find((item) => item.match_id.toLowerCase() === text.toLowerCase() || item.public_id === text.replace(/^#/, '').padStart(6, '0'))
  }

  // The admin types only the winning team's number; the server pays that team's players straight
  // into their winning coins. The confirm box names the team so a typo is caught first.
  const declareWinner = async (matchValue, teamNoValue) => {
    const match = findMatchById(matchValue)
    if (!match) {
      setMessage('Match not found. Enter its number, such as #05.')
      return false
    }
    const teamNo = Number(String(teamNoValue).trim().replace(/^#/, ''))
    const team = overview.entries.filter((entry) => entry.match_id === match.match_id && Number(entry.team_no) === teamNo)
    if (!Number.isInteger(teamNo) || !team.length) {
      const total = new Set(overview.entries.filter((entry) => entry.match_id === match.match_id).map((entry) => entry.team_no)).size
      setMessage(total ? `Match ${formatMatchLabel(match)} has no team #${teamNoValue}. Its teams are #1 to #${total}.` : `Nobody joined match ${formatMatchLabel(match)}.`)
      return false
    }
    const names = team.flatMap((entry) => (entry.identifiers?.length ? entry.identifiers : [entry.user_key])).join(', ')
    if (!window.confirm(`Team #${teamNo} wins match ${formatMatchLabel(match)} · ${match.mode} · ${formatDate(match.match_timestamp)}.\n\nPlayers: ${names}\nAccount: ${team[0].user_key}\n\nTheir winnings go straight to their wallet and cannot be undone. Confirm?`)) return false
    try {
      const data = await api('/api/admin/matches/confirm-result', { method: 'POST', body: JSON.stringify({ matchId: match.match_id, winnerTeamNo: teamNo }) })
      const paidTeam = data.payout.winnerTeamNo ? `team #${data.payout.winnerTeamNo}` : 'the winner'
      setMessage(`Result confirmed: ${paidTeam} won match ${formatMatchLabel(match)}. ${data.payout.payoutPool.toLocaleString()} winning coins added to their wallet.`)
      await loadOverview()
      return true
    } catch (error) {
      setMessage(error.message)
      return false
    }
  }

  const submitResult = async (event) => {
    event.preventDefault()
    if (await declareWinner(resultForm.matchId, resultForm.winnerTeamNo)) setResultForm({ matchId: '', winnerTeamNo: '' })
  }

  const selectMatch = (value) => {
    const match = findMatchById(value)
    if (!match) {
      setMessage('Match not found. Enter its number, such as #05.')
      setSelectedMatch(null)
      return
    }
    setSelectedMatch(match)
    setMatchLookup(formatMatchNo(match.day_no) || match.match_id)
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
          matchId: selectedMatch.match_id,
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
      setMessage(`Match ${formatMatchLabel(data.match)} created for ${formatDate(data.match.match_timestamp)}.`)
      setCreateForm({ mode: matchModes[0], entryFee: String(defaultFees[matchModes[0]]), matchTimestamp: '', prizePool: '', description: '' })
      await loadOverview()
    } catch (error) { setMessage(error.message) }
  }

  const deleteSelectedMatch = async () => {
    if (!selectedMatch || !window.confirm(`Delete match ${formatMatchLabel(selectedMatch)}? Entry fees are refunded to every joined player.`)) return
    try {
      const data = await api('/api/admin/matches/delete', { method: 'DELETE', body: JSON.stringify({ matchId: selectedMatch.match_id }) })
      setSelectedMatch(null)
      setMessage(`Match ${formatMatchLabel(selectedMatch)} deleted.${data.refunds ? ' Entry fees refunded.' : ''}`)
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
                placeholder="Admin email"
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
  const joinedByUser = overview.entries.reduce((counts, entry) => counts.set(entry.user_key, (counts.get(entry.user_key) || 0) + 1), new Map())
  const usersDisplayRows = filteredUsers.map((item) => ({
    ...item,
    status: item.status || 'active',
    online: item.is_online ? 'Online' : 'Offline',
    joined_matches: joinedByUser.get(item.user_key) || 0,
  }))
  const byPendingFirst = (a, b) => (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1) || b.id - a.id
  const pendingPayments = overview.payments.filter((item) => item.status === 'pending')
  const pendingWithdrawals = overview.withdrawals.filter((item) => item.status === 'pending')
  const filteredPayments = overview.payments.filter((item) => (reviewFilter === 'all' || item.status === 'pending') && searchable(item)).sort(byPendingFirst)
  const filteredWithdrawals = overview.withdrawals.filter((item) => (reviewFilter === 'all' || item.status === 'pending') && searchable(item)).sort(byPendingFirst)
  // Newest start time first, with readable times and how many teams really joined.
  const joinedTeams = (matchId) => new Set(overview.entries.filter((entry) => entry.match_id === matchId).map((entry) => entry.team_key)).size
  // Today's and earlier matches, newest day first and #01, #02... within a day, with the start time.
  const today = getIndiaDate()
  const filteredMatches = overview.matches.filter(searchable)
    .sort((a, b) => String(b.match_day).localeCompare(String(a.match_day)) || Number(a.day_no) - Number(b.day_no))
    .map((match) => {
      const winnerNo = match.winner_team_key && overview.entries.find((entry) => entry.match_id === match.match_id && entry.team_key === match.winner_team_key)?.team_no
      return {
        ...match,
        no: formatMatchNo(match.day_no) || match.public_id,
        day: match.match_day === today ? 'Today' : formatDay(match.match_day),
        time: formatTime(match.match_timestamp),
        joined: `${joinedTeams(match.match_id)}/${getMatchCapacity(match.mode).total}`,
        winner: match.winner_team_key ? `${winnerNo ? `#${winnerNo} · ` : ''}${match.winner_team_key}` : '-',
      }
    })
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
        <PaymentReviewTable title="Top-ups waiting for verification" rows={pendingPayments} busy={busy} highlight={highlight} onReview={reviewPayment} onOpenUser={openUser} onViewUpload={viewUpload} emptyText="No top-ups are waiting. New UTR submissions appear here and in Alerts." />
        <div className="admin-grid">
          {userLookupCard}
          <section className="admin-card"><h2>Add active user</h2><p>Register a new active player with a login password. Share the password with the player.</p><form onSubmit={submitCreateUser}><input placeholder="User email / phone" value={userForm.userKey} onChange={(event) => setUserForm({ ...userForm, userKey: event.target.value })} required /><input placeholder="Display name / Gamer tag" value={userForm.displayName} onChange={(event) => setUserForm({ ...userForm, displayName: event.target.value })} required /><input type="text" minLength={6} autoComplete="off" placeholder="Login password for the player (6+ characters)" value={userForm.password} onChange={(event) => setUserForm({ ...userForm, password: event.target.value })} required /><input type="number" min="0" placeholder="Opening credit coins (optional)" value={userForm.creditCoins} onChange={(event) => setUserForm({ ...userForm, creditCoins: event.target.value })} /><button type="submit">Add active user</button></form></section>
          <section className="admin-card"><h2>Record kills</h2><p>Save the final kill count before confirming a result.</p><form onSubmit={submitKills}><input placeholder="Match no., e.g. #05" value={killForm.matchId} onChange={(event) => setKillForm({ ...killForm, matchId: event.target.value })} required /><input placeholder="User email / phone" value={killForm.userKey} onChange={(event) => setKillForm({ ...killForm, userKey: event.target.value })} required /><input type="number" min="0" placeholder="Kills" value={killForm.kills} onChange={(event) => setKillForm({ ...killForm, kills: event.target.value })} required /><button type="submit">Save kills</button></form></section>
          <section className="admin-card"><h2>Confirm winner</h2><p>Enter the match number (#05 = today&apos;s match 5) and the winning team&apos;s number (#1, #2... in the order they joined, shown in Match control). Their winnings go straight to their wallet, and a result can only be paid once.</p><form onSubmit={submitResult}><input placeholder="Match no., e.g. #05" value={resultForm.matchId} onChange={(event) => setResultForm({ ...resultForm, matchId: event.target.value })} required /><input type="number" min="1" step="1" inputMode="numeric" placeholder="Winning team no., e.g. 2" value={resultForm.winnerTeamNo} onChange={(event) => setResultForm({ ...resultForm, winnerTeamNo: event.target.value })} required /><button type="submit">Confirm winner and pay</button></form></section>
        </div>
      </>}

      {(tab === 'payments' || tab === 'withdrawals') && (
        <div className="admin-filter-row">
          {[['pending', 'Pending'], ['all', 'All requests']].map(([value, label]) => (
            <button key={value} type="button" className={reviewFilter === value ? 'selected' : ''} onClick={() => setReviewFilter(value)}>{label}</button>
          ))}
        </div>
      )}
      {tab === 'payments' && <PaymentReviewTable title="Coin top-up requests" rows={filteredPayments} busy={busy} highlight={highlight} onReview={reviewPayment} onOpenUser={openUser} onViewUpload={viewUpload} emptyText={reviewFilter === 'pending' ? 'No pending top-ups.' : 'No top-up requests found.'} />}
      {tab === 'withdrawals' && <WithdrawalReviewTable rows={filteredWithdrawals} busy={busy} highlight={highlight} onReview={reviewWithdrawal} onOpenUser={openUser} onViewUpload={viewUpload} />}

      {tab === 'matches' && <>
        <section className="admin-card admin-create-match"><h2>Create new match</h2><p>Select any available mode, choose its time, and publish a custom prize.</p><form className="admin-create-form" onSubmit={submitCreateMatch}><label>Mode<select value={createForm.mode} onChange={(event) => setCreateForm({ ...createForm, mode: event.target.value, entryFee: String(defaultFees[event.target.value]) })}>{matchModes.map((mode) => <option key={mode} value={mode}>{mode}</option>)}</select></label><label>Entry fee<input type="number" min="1" value={createForm.entryFee} onChange={(event) => setCreateForm({ ...createForm, entryFee: event.target.value })} required /></label><label>Date and time<input type="datetime-local" value={createForm.matchTimestamp} onChange={(event) => setCreateForm({ ...createForm, matchTimestamp: event.target.value })} required /></label><label>Prize pool<input type="number" min="0" value={createForm.prizePool} onChange={(event) => setCreateForm({ ...createForm, prizePool: event.target.value })} placeholder="Optional" /></label><label>Description<textarea value={createForm.description} onChange={(event) => setCreateForm({ ...createForm, description: event.target.value })} placeholder="Per kill 20 Rs..." rows="3" /></label><button type="submit">Create match</button></form></section>
        <section className="admin-card admin-match-lookup"><h2>Match control</h2><p>Enter a match number such as #05 (today&apos;s match 5) to see its teams, declare the winner and edit it.</p><div className="admin-lookup-row"><input value={matchLookup} onChange={(event) => setMatchLookup(event.target.value)} placeholder="#05" /><button type="button" onClick={() => selectMatch(matchLookup)}>Open match</button></div></section>
        {currentSelectedMatch && <MatchControl match={currentSelectedMatch} entries={overview.entries.filter((entry) => entry.match_id === currentSelectedMatch.match_id)} kills={overview.kills.filter((item) => item.match_id === currentSelectedMatch.match_id)} form={matchForm} setForm={setMatchForm} onSubmit={submitMatchUpdate} onDelete={deleteSelectedMatch} onOpenUser={openUser} onDeclareWinner={(teamNo) => declareWinner(currentSelectedMatch.match_id, teamNo)} />}
        <DataTable title="Matches · tap a row to open it" columns={['no', 'time', 'day', 'mode', 'entry_fee', 'joined', 'prize_pool', 'status', 'winner']} rows={filteredMatches} onRowClick={(row) => selectMatch(row.match_id)} />
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
            onViewUpload={viewUpload}
          />
        )}
        <DataTable title="Users · tap a row to see full details and joined matches" columns={['user_key', 'display_name', 'status', 'online', 'joined_matches', 'credit_coins', 'winning_coins', 'created_at']} rows={usersDisplayRows} onRowClick={(row) => loadUser(row.user_key)} />
      </>}
      {screenshot && (
        <div className="admin-shot-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setScreenshot(null)}>
          <figure className="admin-shot" role="dialog" aria-modal="true" aria-label={screenshot.title}>
            <figcaption><span>{screenshot.title}{screenshot.uploadedAt && <small>Uploaded {formatDate(screenshot.uploadedAt)}</small>}</span><button type="button" onClick={() => setScreenshot(null)}>Close</button></figcaption>
            {screenshot.dataUrl ? <img src={screenshot.dataUrl} alt={screenshot.title} /> : <p>{screenshot.error || 'Loading screenshot...'}</p>}
          </figure>
        </div>
      )}
    </main>
  )
}

function PaymentReviewTable({ title, rows, busy, highlight, onReview, onOpenUser, onViewUpload, emptyText }) {
  return (
    <section className="admin-table-card admin-review-card">
      <div className="admin-card-heading"><h2>{title}</h2><span>{rows.length} records</span></div>
      <div className="admin-table-wrap">
        <table>
          <thead><tr><th>ID</th><th>User</th><th>Coins</th><th>Paid ₹</th><th>UTR</th><th>Proof</th><th>Status</th><th>Submitted</th><th>Action</th></tr></thead>
          <tbody>
            {rows.length ? rows.map((row) => (
              <tr key={row.id} id={`payment-${row.id}`} className={highlight?.type === 'payment' && highlight.id === row.id ? 'is-highlighted' : ''}>
                <td>#{row.id}</td>
                <td><button type="button" className="admin-user-link" onClick={() => onOpenUser(row.user_key)}>{row.user_key}</button></td>
                <td>{row.coins.toLocaleString()}</td>
                <td>{row.amount.toLocaleString()}</td>
                <td><code className="admin-utr">{row.utr || '-'}</code>{row.utr && <CopyButton value={row.utr} />}</td>
                <td><ScreenshotButton show={row.has_screenshot} onView={() => onViewUpload('payment', row.id, `Top-up #${row.id} · UTR ${row.utr} · ${row.user_key}`)} /></td>
                <td><span className={`admin-status is-${row.status}`} title={row.review_note || undefined}>{row.status}</span></td>
                <td>{formatDate(row.created_at)}</td>
                <td>{row.status === 'pending' ? <ReviewButtons busy={busy} onApprove={() => onReview(row, 'approve')} onReject={() => onReview(row, 'reject')} /> : <small>{formatDate(row.reviewed_at)}{row.review_note ? ` · ${row.review_note}` : ''}</small>}</td>
              </tr>
            )) : <tr><td colSpan="9">{emptyText}</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function WithdrawalReviewTable({ rows, busy, highlight, onReview, onOpenUser, onViewUpload }) {
  return (
    <section className="admin-table-card admin-review-card">
      <div className="admin-card-heading"><h2>Withdrawal requests</h2><span>{rows.length} records</span></div>
      <div className="admin-table-wrap">
        <table>
          <thead><tr><th>ID</th><th>User</th><th>Coins</th><th>Method</th><th>Pay to</th><th>QR</th><th>Status</th><th>Requested</th><th>Action</th></tr></thead>
          <tbody>
            {rows.length ? rows.map((row) => (
              <tr key={row.id} id={`withdrawal-${row.id}`} className={highlight?.type === 'withdrawal' && highlight.id === row.id ? 'is-highlighted' : ''}>
                <td>#{row.id}</td>
                <td><button type="button" className="admin-user-link" onClick={() => onOpenUser(row.user_key)}>{row.user_key}</button></td>
                <td>{row.amount.toLocaleString()}</td>
                <td>{row.method.toUpperCase()}</td>
                <td><code className="admin-utr">{withdrawalDestination(row)}</code></td>
                <td><ScreenshotButton show={row.has_screenshot} onView={() => onViewUpload('withdrawal', row.id, `Withdrawal #${row.id} · ${withdrawalDestination(row)}`)} /></td>
                <td><span className={`admin-status is-${row.status}`} title={row.review_note || undefined}>{row.status}</span></td>
                <td>{formatDate(row.created_at)}</td>
                <td>{row.status === 'pending' ? <ReviewButtons busy={busy} approveLabel="Mark paid" onApprove={() => onReview(row, 'approve')} onReject={() => onReview(row, 'reject')} /> : <small>{formatDate(row.reviewed_at)}{row.review_note ? ` · ${row.review_note}` : ''}</small>}</td>
              </tr>
            )) : <tr><td colSpan="9">No withdrawal requests found.</td></tr>}
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

// Joined teams by number (#1, #2... in join order). The admin declares the winner by that number.
function MatchControl({ match, entries, kills, form, setForm, onSubmit, onDelete, onOpenUser, onDeclareWinner }) {
  const [winnerNo, setWinnerNo] = useState('')
  const teams = [...entries.reduce((byNo, entry) => {
    const teamNo = Number(entry.team_no) || 0
    if (!byNo.has(teamNo)) byNo.set(teamNo, { teamNo, teamKey: entry.team_key, members: [] })
    byNo.get(teamNo).members.push(entry)
    return byNo
  }, new Map()).values()].sort((a, b) => a.teamNo - b.teamNo)
  const winner = match.status === 'confirmed' ? teams.find((team) => team.teamKey === match.winner_team_key) : null
  const declare = async (event) => {
    event.preventDefault()
    if (await onDeclareWinner(winnerNo)) setWinnerNo('')
  }

  return (
    <section className="admin-match-control">
      <div className="admin-card-heading">
        <div><h2>{formatMatchLabel(match)} · {match.mode || 'Match'} · {formatTime(match.match_timestamp)}</h2><span>{match.status} · {teams.length} joined {teams.length === 1 ? 'team' : 'teams'}</span></div>
        <button className="admin-delete-button" type="button" onClick={onDelete}>Delete match</button>
      </div>
      <div className="admin-match-columns">
        <div>
          <h3>Joined teams</h3>
          <div className="admin-player-list">
            {teams.length ? teams.map((team) => (
              <div key={team.teamNo} className={winner?.teamNo === team.teamNo ? 'is-winner' : ''}>
                <b className="admin-team-no">#{team.teamNo || '?'}</b>
                <strong><button type="button" className="admin-user-link" onClick={() => onOpenUser(team.members[0].user_key)}>{team.teamKey}</button></strong>
                <span>{team.members.flatMap((entry) => (entry.identifiers?.length ? entry.identifiers : [entry.user_key])).join(', ')}</span>
                <small>{team.members.reduce((total, entry) => total + (kills.find((item) => item.user_key === entry.user_key)?.kills || 0), 0)} kills{winner?.teamNo === team.teamNo ? ' · WINNER' : ''}</small>
              </div>
            )) : <p>No players recorded.</p>}
          </div>
          {match.status === 'confirmed' ? (
            <p className="admin-winner-note">Result confirmed: team #{winner?.teamNo || '?'} won and has been paid.</p>
          ) : teams.length > 0 && (
            <form className="admin-winner-form" onSubmit={declare}>
              <label>Winning team no.
                <input type="number" min="1" max={teams.length} step="1" inputMode="numeric" value={winnerNo} onChange={(event) => setWinnerNo(event.target.value)} placeholder={`1 to ${teams.length}`} required />
              </label>
              <button type="submit">Declare winner and pay</button>
            </form>
          )}
        </div>
        <form className="admin-match-form" onSubmit={onSubmit}><label>Entry fee<input type="number" min="1" value={form.entryFee} onChange={(event) => setForm({ ...form, entryFee: event.target.value })} required /></label><label>Match time<input type="datetime-local" value={form.matchTimestamp} onChange={(event) => setForm({ ...form, matchTimestamp: event.target.value })} /></label><label>Prize payout override<input type="number" min="0" value={form.prizePool} onChange={(event) => setForm({ ...form, prizePool: event.target.value })} placeholder="Default: 80% pool" /></label><label>Match description<textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Per kill 20 Rs... or Prize pool 40 Rs..." rows="4" /></label><label>Room ID<input value={form.roomId} onChange={(event) => setForm({ ...form, roomId: event.target.value })} placeholder="Shown to joined players 10 min before start" maxLength={40} /></label><label>Room password<input value={form.roomPassword} onChange={(event) => setForm({ ...form, roomPassword: event.target.value })} placeholder="Room password" maxLength={40} /></label><button type="submit">Save match changes</button></form>
      </div>
    </section>
  )
}

function DataTable({ title, columns, rows, onRowClick }) {
  return <section className="admin-table-card"><div className="admin-card-heading"><h2>{title}</h2><span>{rows.length} records</span></div><div className="admin-table-wrap"><table><thead><tr>{columns.map((column) => <th key={column}>{column.replaceAll('_', ' ')}</th>)}</tr></thead><tbody>{rows.length ? rows.map((row, index) => <tr key={`${row.id || row.match_id || row.user_key}-${index}`} className={onRowClick ? 'is-clickable' : ''} onClick={() => onRowClick?.(row)}>{columns.map((column) => <td key={column}>{String(row[column] ?? '-')}</td>)}</tr>) : <tr><td colSpan={columns.length}>No records found.</td></tr>}</tbody></table></div></section>
}

export default AdminPanel
