import { useEffect, useRef, useState } from 'react'
import AdminUserDetail, { ReviewButtons } from './AdminUserDetail'
import { formatDate, formatDay, formatTime, timeAgo, withdrawalDestination } from './adminFormat'
import ScreenshotButton from './ScreenshotButton'
import { DEFAULT_ENTRY_FEES, MATCH_MODES, getDefaultPerKill, paysWinnerByDefault, formatMatchLabel, formatMatchNo, getIndiaDate, getMatchCapacity, pickByMatchNo } from '../../lib/match-schedule.js'

const emptyOverview = { users: [], matches: [], entries: [], payments: [], withdrawals: [], kills: [], notifications: [], unreadNotifications: 0 }
// The same modes and fees the daily schedule uses, so changing a fee in one place changes both.
const matchModes = MATCH_MODES
const defaultFees = DEFAULT_ENTRY_FEES
const adminTitle = 'ADMIN DESK · ARENACORE'
const CURRENT_MATCH_WINDOW_MS = 2 * 60 * 60 * 1000
const AWAITING_RESULT_WINDOW_MS = 2 * 24 * 60 * 60 * 1000
// Joined players see the room 10 minutes before the start, so it should be set well before that.
const ROOM_WARNING_WINDOW_MS = 2 * 60 * 60 * 1000
const ROOM_REVEAL_WARNING_MS = 10 * 60 * 1000
const matchStateLabels = { upcoming: 'Upcoming', result: 'Needs result', done: 'Done', empty: 'No players' }

// Match times are entered and shown in India time, whatever time zone the admin's device uses;
// reading the box as device time saved a match hours off (and on the wrong day) outside India.
const IST_OFFSET_MS = 330 * 60 * 1000
function toLocalInputValue(timestamp) {
  if (!timestamp) return ''
  return new Date(Number(timestamp) + IST_OFFSET_MS).toISOString().slice(0, 16)
}
function fromIstInputValue(value) {
  return value ? Date.parse(`${value}:00Z`) - IST_OFFSET_MS : ''
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
  // matchKey is the exact match picked from "Matches waiting for a result"; typing a number clears it.
  const emptyKillForm = { matchId: '', matchKey: '', userKey: '', kills: '' }
  const emptyResultForm = { matchId: '', matchKey: '', winnerTeamNo: '' }
  const [killForm, setKillForm] = useState(emptyKillForm)
  const [resultForm, setResultForm] = useState(emptyResultForm)
  const [matchLookup, setMatchLookup] = useState('')
  // Which matches the table lists: 'today' (today's and upcoming), 'all', or one India date (YYYY-MM-DD).
  const [matchDay, setMatchDay] = useState('today')
  // Which match states the table lists: 'all', 'upcoming', 'result' (started, needs a winner) or 'done'.
  const [matchState, setMatchState] = useState('all')
  // When the overview was last loaded; the 5 s refresh keeps it current, so "today" rolls over at midnight.
  const [loadedAt, setLoadedAt] = useState(() => Date.now())
  const [selectedMatch, setSelectedMatch] = useState(null)
  const [matchForm, setMatchForm] = useState({ entryFee: '', matchTimestamp: '', prizePool: '', perKill: '', description: '', roomId: '', roomPassword: '' })
  // The match form's save button: 'idle', 'saving', 'saved' (green until the next edit) or 'error'.
  const [matchSaveState, setMatchSaveState] = useState('idle')
  const [createForm, setCreateForm] = useState({ mode: matchModes[0], entryFee: String(defaultFees[matchModes[0]]), matchTimestamp: '', prizePool: '', perKill: '', description: '' })
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
    setLoadedAt(Date.now())
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
        setLoadedAt(Date.now())

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
      const data = await api('/api/admin/matches/kills', { method: 'POST', body: JSON.stringify({ matchId: killForm.matchKey || killForm.matchId, kills: [{ userKey: killForm.userKey, kills: Number(killForm.kills) }] }) })
      const paid = data.results?.[0]
      // The match stays filled in, so the next team's kills are one pick away.
      setKillForm({ ...killForm, userKey: '', kills: '' })
      setMessage(`Kill count saved for ${killForm.userKey}.${paid?.change > 0 ? ` ${paid.change} kill coins paid (${data.perKill} per kill).` : paid?.change < 0 ? ` ${-paid.change} kill coins taken back.` : ''}`)
      await loadOverview()
    } catch (error) { setMessage(error.message) }
  }

  // "#05" is the match 5 that starts closest to now; internal ids and old six-digit ids work too.
  const findMatchById = (value) => {
    const text = String(value || '').trim()
    return pickByMatchNo(overview.matches, text)
      || overview.matches.find((item) => item.match_id.toLowerCase() === text.toLowerCase() || item.public_id === text.replace(/^#/, '').padStart(6, '0'))
  }

  // The match a card's form points at: the exact one picked from the list, else the typed number.
  const formMatch = (form) => (form.matchKey ? overview.matches.find((item) => item.match_id === form.matchKey) : String(form.matchId || '').trim() ? findMatchById(form.matchId) : null) || null
  const teamsOf = (match) => (match ? groupTeams(overview.entries.filter((entry) => entry.match_id === match.match_id), overview.kills.filter((item) => item.match_id === match.match_id)) : [])

  // From "Room ID needed": opens the match in Match control with the room ID box focused.
  const openMatchRoom = (match) => {
    setTab('matches')
    selectMatch(match.match_id)
    window.setTimeout(() => {
      const input = document.querySelector('.admin-match-form input[name="roomId"]')
      input?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      input?.focus({ preventScroll: true })
    }, 80)
  }

  // From "Matches waiting for a result": fills a card with that exact match and scrolls to it.
  const startResult = (match) => {
    setResultForm({ matchId: formatMatchLabel(match), matchKey: match.match_id, winnerTeamNo: '' })
    window.setTimeout(() => document.getElementById('admin-confirm-winner')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50)
  }
  const startKills = (match) => {
    setKillForm({ ...emptyKillForm, matchId: formatMatchLabel(match), matchKey: match.match_id })
    window.setTimeout(() => document.getElementById('admin-record-kills')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50)
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
    if (await declareWinner(resultForm.matchKey || resultForm.matchId, resultForm.winnerTeamNo)) setResultForm(emptyResultForm)
  }

  const matchFormValues = (match) => ({
    entryFee: String(match.entry_fee),
    matchTimestamp: toLocalInputValue(match.match_timestamp),
    prizePool: match.prize_pool === null || match.prize_pool === undefined ? '' : String(match.prize_pool),
    perKill: match.per_kill === null || match.per_kill === undefined ? '' : String(match.per_kill),
    description: match.description || '',
    roomId: match.room_id || '',
    roomPassword: match.room_password || '',
  })

  const editMatchForm = (next) => {
    setMatchForm(next)
    setMatchSaveState('idle')
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
    setMatchForm(matchFormValues(match))
    setMatchSaveState('idle')
    setMessage('Match details loaded.')
  }

  // Saves straight away and shows it on the button. The saved match from the server replaces the
  // row in place, so there is no wait for the whole overview to reload (the 5 s refresh follows).
  const submitMatchUpdate = async (event) => {
    event.preventDefault()
    if (!selectedMatch || matchSaveState === 'saving') return
    setMatchSaveState('saving')
    try {
      const data = await api('/api/admin/matches/update', {
        method: 'PATCH',
        body: JSON.stringify({
          matchId: selectedMatch.match_id,
          entryFee: Number(matchForm.entryFee),
          matchTimestamp: fromIstInputValue(matchForm.matchTimestamp),
          prizePool: matchForm.prizePool === '' ? '' : Number(matchForm.prizePool),
          perKill: matchForm.perKill === '' ? null : Number(matchForm.perKill),
          description: matchForm.description,
          roomId: matchForm.roomId,
          roomPassword: matchForm.roomPassword,
        }),
      })
      const saved = data.match
      if (saved) {
        setOverview((current) => ({ ...current, matches: current.matches.map((match) => (match.match_id === saved.match_id ? { ...match, ...saved } : match)) }))
        setSelectedMatch(saved)
        setMatchForm(matchFormValues(saved))
      }
      setMatchSaveState('saved')
      setMessage(`Match ${formatMatchLabel(saved || selectedMatch)} saved. Players see the changes on their next refresh.`)
    } catch (error) {
      setMatchSaveState('error')
      setMessage(error.message)
    }
  }

  const submitCreateMatch = async (event) => {
    event.preventDefault()
    try {
      const data = await api('/api/admin/matches/create', {
        method: 'POST',
        body: JSON.stringify({
          ...createForm,
          entryFee: Number(createForm.entryFee),
          matchTimestamp: fromIstInputValue(createForm.matchTimestamp),
          prizePool: createForm.prizePool === '' ? null : Number(createForm.prizePool),
          perKill: createForm.perKill === '' ? null : Number(createForm.perKill),
        }),
      })
      setMessage(`Match ${formatMatchLabel(data.match)} created for ${formatDate(data.match.match_timestamp)}.`)
      setCreateForm({ mode: matchModes[0], entryFee: String(defaultFees[matchModes[0]]), matchTimestamp: '', prizePool: '', perKill: '', description: '' })
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
  // By default only today's matches (and any still to come) are listed, so each new day starts
  // with a fresh list. Matches that started in the last 2 hours stay, like last night's 1:20 AM one.
  // Older days are one pick away in the day filter.
  const now = loadedAt
  const today = getIndiaDate(now)
  const isCurrentMatch = (match) => match.match_day === today || Number(match.match_timestamp) >= now - CURRENT_MATCH_WINDOW_MS
  const matchDays = [...new Set(overview.matches.map((match) => match.match_day).filter(Boolean))].sort().reverse()
  const inSelectedDay = (match) => (matchDay === 'all' ? true : matchDay === 'today' ? isCurrentMatch(match) : match.match_day === matchDay)
  const currentMatchCount = overview.matches.filter(isCurrentMatch).length
  const stateOf = (match) => {
    if (match.status === 'confirmed') return 'done'
    if (Number(match.match_timestamp) > now) return 'upcoming'
    return joinedTeams(match.match_id) > 0 ? 'result' : 'empty'
  }
  const dayMatches = overview.matches.filter(inSelectedDay)
  const stateCounts = dayMatches.reduce((counts, match) => ({ ...counts, [stateOf(match)]: (counts[stateOf(match)] || 0) + 1 }), {})
  const filteredMatches = dayMatches.filter((match) => matchState === 'all' || stateOf(match) === matchState)
    .sort((a, b) => String(b.match_day).localeCompare(String(a.match_day)) || Number(a.day_no) - Number(b.day_no))
    .map((match) => {
      const winnerNo = match.winner_team_key && overview.entries.find((entry) => entry.match_id === match.match_id && entry.team_key === match.winner_team_key)?.team_no
      return {
        ...match,
        no: formatMatchNo(match.day_no) || match.public_id,
        day: match.match_day === today ? 'Today' : formatDay(match.match_day),
        time: formatTime(match.match_timestamp),
        joined: `${joinedTeams(match.match_id)}/${getMatchCapacity(match.mode).total}`,
        state: matchStateLabels[stateOf(match)],
        // A free launch-offer match costs nothing to join; its fee still sets the prize.
        entry_fee: Number(match.free_entry) === 1 ? `Free (prize as ${match.entry_fee})` : match.entry_fee,
        room: match.room_id ? 'Set' : '-',
        winner: match.winner_team_key ? `${winnerNo ? `#${winnerNo} · ` : ''}${match.winner_team_key}` : '-',
      }
    })
    // Searched after "#05", "8:00 pm" and the day are added, so those can be typed into the search.
    .filter(searchable)
  // Started in the last two days, someone joined, and no winner yet: these still need a result.
  const awaitingResult = overview.matches
    .filter((match) => match.status !== 'confirmed' && Number(match.match_timestamp) <= now && Number(match.match_timestamp) >= now - AWAITING_RESULT_WINDOW_MS && joinedTeams(match.match_id) > 0)
    .sort((a, b) => Number(a.match_timestamp) - Number(b.match_timestamp))
  // Starting in the next two hours with players joined, but no room ID or password yet.
  const roomNeeded = overview.matches
    .filter((match) => match.status !== 'confirmed' && Number(match.match_timestamp) > now && Number(match.match_timestamp) <= now + ROOM_WARNING_WINDOW_MS && joinedTeams(match.match_id) > 0 && (!match.room_id || !match.room_password))
    .sort((a, b) => Number(a.match_timestamp) - Number(b.match_timestamp))
  const startsIn = (match) => {
    const minutes = Math.max(0, Math.round((Number(match.match_timestamp) - now) / 60000))
    return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`
  }
  const resultMatch = formMatch(resultForm)
  const resultTeams = teamsOf(resultMatch)
  const killMatch = formMatch(killForm)
  const killTeams = teamsOf(killMatch)
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
        <button type="button" onClick={() => { setTab('matches'); setMatchDay('today') }}><span>Today&apos;s matches</span><strong>{currentMatchCount}</strong><small>{overview.matches.length} in total</small></button>
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
        {roomNeeded.length > 0 && (
          <section className="admin-table-card admin-room-needed">
            <div className="admin-card-heading"><h2>Room ID needed</h2><span>{roomNeeded.length} starting soon</span></div>
            <p className="admin-empty-note">Joined players see the room ID and password 10 minutes before the start. Set them before then.</p>
            <div className="admin-table-wrap">
              <table>
                <thead><tr><th>Match</th><th>Next step</th><th>Starts in</th><th>Teams</th><th>Mode</th></tr></thead>
                <tbody>
                  {roomNeeded.map((match) => (
                    <tr key={match.match_id} className={Number(match.match_timestamp) - now <= ROOM_REVEAL_WARNING_MS ? 'is-urgent' : ''}>
                      <td><strong>{formatMatchLabel(match)}</strong></td>
                      <td><div className="admin-row-actions"><button type="button" className="is-primary" onClick={() => openMatchRoom(match)}>Set room</button></div></td>
                      <td>{startsIn(match)} · {formatTime(match.match_timestamp)}</td>
                      <td>{joinedTeams(match.match_id)}</td>
                      <td>{match.mode}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
        <section className="admin-table-card admin-awaiting">
          <div className="admin-card-heading"><h2>Matches waiting for a result</h2><span>{awaitingResult.length} {awaitingResult.length === 1 ? 'match' : 'matches'}</span></div>
          {awaitingResult.length ? (
            <div className="admin-table-wrap">
              <table>
                <thead><tr><th>Match</th><th>Next step</th><th>Started</th><th>Teams</th><th>Kills saved</th><th>Mode</th></tr></thead>
                <tbody>
                  {awaitingResult.map((match) => (
                    <tr key={match.match_id}>
                      <td><strong>{formatMatchLabel(match)}</strong></td>
                      <td>
                        <div className="admin-row-actions">
                          <button type="button" onClick={() => startKills(match)}>Record kills</button>
                          <button type="button" className="is-primary" onClick={() => startResult(match)}>Confirm winner</button>
                        </div>
                      </td>
                      <td>{formatTime(match.match_timestamp)}</td>
                      <td>{joinedTeams(match.match_id)}</td>
                      <td>{new Set(overview.kills.filter((item) => item.match_id === match.match_id).map((item) => item.user_key)).size}</td>
                      <td>{match.mode}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="admin-empty-note">No started match is waiting for a result. Matches appear here once they start and someone has joined.</p>}
        </section>
        <div className="admin-grid">
          {userLookupCard}
          <section className="admin-card"><h2>Add active user</h2><p>Register a new active player with a login password. Share the password with the player.</p><form onSubmit={submitCreateUser}><input placeholder="User email / phone" value={userForm.userKey} onChange={(event) => setUserForm({ ...userForm, userKey: event.target.value })} required /><input placeholder="Display name / Gamer tag" value={userForm.displayName} onChange={(event) => setUserForm({ ...userForm, displayName: event.target.value })} required /><input type="text" minLength={6} autoComplete="off" placeholder="Login password for the player (6+ characters)" value={userForm.password} onChange={(event) => setUserForm({ ...userForm, password: event.target.value })} required /><input type="number" min="0" placeholder="Opening credit coins (optional)" value={userForm.creditCoins} onChange={(event) => setUserForm({ ...userForm, creditCoins: event.target.value })} /><button type="submit">Add active user</button></form></section>
          <section className="admin-card" id="admin-record-kills">
            <h2>Record kills</h2>
            <p>Enter the match number, then pick the team from the list. The match stays filled in for the next team.</p>
            <form onSubmit={submitKills}>
              <input placeholder="Match no., e.g. #05" value={killForm.matchId} onChange={(event) => setKillForm({ ...killForm, matchId: event.target.value, matchKey: '', userKey: '' })} required />
              {killTeams.length ? (
                <select value={killForm.userKey} onChange={(event) => setKillForm({ ...killForm, userKey: event.target.value })} required>
                  <option value="">Pick the team…</option>
                  {killTeams.flatMap((team) => team.members.map((member) => <option key={member.user_key} value={member.user_key}>#{team.teamNo} · {memberNames(member)} · {member.user_key}</option>))}
                </select>
              ) : (
                <input placeholder="User email / phone" value={killForm.userKey} onChange={(event) => setKillForm({ ...killForm, userKey: event.target.value })} required />
              )}
              <input type="number" min="0" placeholder="Kills" value={killForm.kills} onChange={(event) => setKillForm({ ...killForm, kills: event.target.value })} required />
              <button type="submit">Save kills</button>
            </form>
            <MatchTeamsPreview typed={killForm.matchId} match={killMatch} teams={killTeams} selectedKey={killForm.userKey} onPick={(team) => setKillForm({ ...killForm, userKey: team.members[0].user_key })} />
          </section>
          <section className="admin-card" id="admin-confirm-winner">
            <h2>Confirm winner</h2>
            <p>Enter the match number (#05 = today&apos;s match 5). Its joined teams appear below: tap the winning team, check the names, and confirm. Winnings go straight to their wallet, and a result can only be paid once.</p>
            <form onSubmit={submitResult}>
              <input placeholder="Match no., e.g. #05" value={resultForm.matchId} onChange={(event) => setResultForm({ ...resultForm, matchId: event.target.value, matchKey: '', winnerTeamNo: '' })} required />
              <input type="number" min="1" step="1" inputMode="numeric" placeholder="Winning team no., e.g. 2" value={resultForm.winnerTeamNo} onChange={(event) => setResultForm({ ...resultForm, winnerTeamNo: event.target.value })} required />
              <button type="submit" disabled={resultMatch?.status === 'confirmed'}>{resultMatch?.status === 'confirmed' ? 'Already confirmed' : resultForm.winnerTeamNo ? `Confirm team #${resultForm.winnerTeamNo} and pay` : 'Confirm winner and pay'}</button>
            </form>
            <MatchTeamsPreview typed={resultForm.matchId} match={resultMatch} teams={resultTeams} selectedNo={Number(resultForm.winnerTeamNo) || null} onPick={resultMatch?.status === 'confirmed' ? null : (team) => setResultForm({ ...resultForm, winnerTeamNo: String(team.teamNo) })} />
          </section>
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
        <section className="admin-card admin-create-match"><h2>Create new match</h2><p>Select any available mode, choose its time, and publish a custom prize.</p><form className="admin-create-form" onSubmit={submitCreateMatch}><label>Mode<select value={createForm.mode} onChange={(event) => setCreateForm({ ...createForm, mode: event.target.value, entryFee: String(defaultFees[event.target.value]) })}>{matchModes.map((mode) => <option key={mode} value={mode}>{mode}</option>)}</select></label><label>Entry fee<input type="number" min="1" value={createForm.entryFee} onChange={(event) => setCreateForm({ ...createForm, entryFee: event.target.value })} required /></label><label>Date and time (India time)<input type="datetime-local" value={createForm.matchTimestamp} onChange={(event) => setCreateForm({ ...createForm, matchTimestamp: event.target.value })} required /></label><label>Winning coins<input type="number" min="0" value={createForm.prizePool} onChange={(event) => setCreateForm({ ...createForm, prizePool: event.target.value })} placeholder={paysWinnerByDefault(createForm.mode) ? 'Default: 80% of fees' : 'Default: none (pays per kill)'} /></label><label>Per kill coins<input type="number" min="0" value={createForm.perKill} onChange={(event) => setCreateForm({ ...createForm, perKill: event.target.value })} placeholder={`Default: ${getDefaultPerKill(createForm.mode, createForm.entryFee)}`} /></label><label>Description<textarea value={createForm.description} onChange={(event) => setCreateForm({ ...createForm, description: event.target.value })} placeholder="Per kill 20 Rs..." rows="3" /></label><button type="submit">Create match</button></form></section>
        <section className="admin-card admin-match-lookup"><h2>Match control</h2><p>Enter a match number such as #05 (today&apos;s match 5) to see its teams, declare the winner and edit it.</p><div className="admin-lookup-row"><input value={matchLookup} onChange={(event) => setMatchLookup(event.target.value)} placeholder="#05" /><button type="button" onClick={() => selectMatch(matchLookup)}>Open match</button></div></section>
        {currentSelectedMatch && <MatchControl key={currentSelectedMatch.match_id} match={currentSelectedMatch} entries={overview.entries.filter((entry) => entry.match_id === currentSelectedMatch.match_id)} kills={overview.kills.filter((item) => item.match_id === currentSelectedMatch.match_id)} form={matchForm} setForm={editMatchForm} saveState={matchSaveState} onSubmit={submitMatchUpdate} onDelete={deleteSelectedMatch} onOpenUser={openUser} onDeclareWinner={(teamNo) => declareWinner(currentSelectedMatch.match_id, teamNo)} />}
        <div className="admin-filter-row admin-state-filter">
          {[['all', 'All'], ['upcoming', 'Upcoming'], ['result', 'Needs result'], ['done', 'Done']].map(([value, label]) => (
            <button key={value} type="button" className={matchState === value ? 'selected' : ''} onClick={() => setMatchState(value)}>
              {label}{value !== 'all' && <span className="admin-filter-count">{stateCounts[value] || 0}</span>}
            </button>
          ))}
        </div>
        <div className="admin-filter-row admin-day-filter">
          <button type="button" className={matchDay === 'today' ? 'selected' : ''} onClick={() => setMatchDay('today')}>Today &amp; upcoming</button>
          <button type="button" className={matchDay === 'all' ? 'selected' : ''} onClick={() => setMatchDay('all')}>All days</button>
          <select aria-label="Show matches of one day" value={matchDays.includes(matchDay) ? matchDay : ''} onChange={(event) => setMatchDay(event.target.value || 'today')}>
            <option value="">Pick a past day…</option>
            {matchDays.map((day) => <option key={day} value={day}>{day === today ? 'Today' : formatDay(day)}</option>)}
          </select>
        </div>
        <DataTable title={`Matches · ${matchDay === 'today' ? 'today' : matchDay === 'all' ? 'all days' : formatDay(matchDay)} · tap a row to open it`} columns={['no', 'time', 'day', 'mode', 'state', 'joined', 'entry_fee', 'room', 'winner']} rows={filteredMatches} onRowClick={(row) => selectMatch(row.match_id)} />
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
const saveButtonLabels = { idle: 'Save match changes', saving: 'Saving…', saved: 'Saved ✓', error: 'Not saved · try again' }

// A team's in-game names, or its account when no names were given.
function memberNames(entry) {
  return entry.identifiers?.length ? entry.identifiers.join(', ') : entry.user_key
}

// Joined teams by number (#1, #2... in join order), each with its players and total kills.
function groupTeams(entries, kills = []) {
  return [...entries.reduce((byNo, entry) => {
    const teamNo = Number(entry.team_no) || 0
    if (!byNo.has(teamNo)) byNo.set(teamNo, { teamNo, teamKey: entry.team_key, members: [], kills: 0 })
    const team = byNo.get(teamNo)
    team.members.push(entry)
    team.kills += Number(kills.find((item) => item.user_key === entry.user_key)?.kills || 0)
    return byNo
  }, new Map()).values()].sort((a, b) => a.teamNo - b.teamNo)
}

// Shown under "Confirm winner" and "Record kills" once a match number is typed: which match it
// found and every joined team with its number, names and kills. Tapping a team fills the form.
function MatchTeamsPreview({ typed, match, teams, selectedNo = null, selectedKey = '', onPick }) {
  if (!String(typed || '').trim()) return null
  if (!match) return <p className="admin-team-preview admin-team-preview-empty">No match found for “{typed}”. Use its number, such as #05.</p>
  const winner = match.status === 'confirmed' ? teams.find((team) => team.teamKey === match.winner_team_key) : null
  return (
    <div className="admin-team-preview">
      <p className="admin-team-preview-head">
        <strong>{formatMatchLabel(match)}</strong> · {match.mode} · {formatTime(match.match_timestamp)} · {teams.length} {teams.length === 1 ? 'team' : 'teams'} joined
        {winner && <em> · team #{winner.teamNo} already won</em>}
      </p>
      {teams.length ? (
        <div className="admin-player-list">
          {teams.map((team) => {
            const selected = selectedNo === team.teamNo || team.members.some((member) => member.user_key === selectedKey)
            return (
              <button key={team.teamNo} type="button" className={`${selected ? 'is-selected' : ''} ${winner?.teamNo === team.teamNo ? 'is-winner' : ''}`} onClick={() => onPick?.(team)} disabled={!onPick} aria-pressed={selected}>
                <b className="admin-team-no">#{team.teamNo || '?'}</b>
                <strong>{team.teamKey}</strong>
                <span>{team.members.map(memberNames).join(', ')}</span>
                <small>{team.kills} kills{winner?.teamNo === team.teamNo ? ' · WINNER' : ''}</small>
              </button>
            )
          })}
        </div>
      ) : <p className="admin-team-preview-empty">Nobody joined this match yet.</p>}
    </div>
  )
}

function MatchControl({ match, entries, kills, form, setForm, saveState = 'idle', onSubmit, onDelete, onOpenUser, onDeclareWinner }) {
  const [winnerNo, setWinnerNo] = useState('')
  const teams = groupTeams(entries, kills)
  const winner = match.status === 'confirmed' ? teams.find((team) => team.teamKey === match.winner_team_key) : null
  const canPick = match.status !== 'confirmed'
  const pickTeam = (team) => { if (canPick) setWinnerNo(String(team.teamNo)) }
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
          <h3>Joined teams{canPick && teams.length > 0 ? ' · tap the winning team' : ''}</h3>
          <div className="admin-player-list">
            {teams.length ? teams.map((team) => (
              <div
                key={team.teamNo}
                className={`${winner?.teamNo === team.teamNo ? 'is-winner' : ''} ${canPick ? 'is-pickable' : ''} ${canPick && Number(winnerNo) === team.teamNo ? 'is-selected' : ''}`}
                onClick={() => pickTeam(team)}
                onKeyDown={(event) => { if (canPick && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); pickTeam(team) } }}
                role={canPick ? 'button' : undefined}
                tabIndex={canPick ? 0 : undefined}
                aria-pressed={canPick ? Number(winnerNo) === team.teamNo : undefined}
              >
                <b className="admin-team-no">#{team.teamNo || '?'}</b>
                <strong><button type="button" className="admin-user-link" onClick={(event) => { event.stopPropagation(); onOpenUser(team.members[0].user_key) }}>{team.teamKey}</button></strong>
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
              <button type="submit">{winnerNo ? `Declare team #${winnerNo} winner and pay` : 'Declare winner and pay'}</button>
            </form>
          )}
        </div>
        <form className="admin-match-form" onSubmit={onSubmit}><label>Entry fee<input type="number" min="1" value={form.entryFee} onChange={(event) => setForm({ ...form, entryFee: event.target.value })} required /></label><label>Match time (India time)<input type="datetime-local" value={form.matchTimestamp} onChange={(event) => setForm({ ...form, matchTimestamp: event.target.value })} /></label><label>Winning coins<input type="number" min="0" value={form.prizePool} onChange={(event) => setForm({ ...form, prizePool: event.target.value })} placeholder={paysWinnerByDefault(match.mode) ? 'Default: 80% of fees' : 'Default: none (pays per kill)'} /></label><label>Per kill coins<input type="number" min="0" value={form.perKill} onChange={(event) => setForm({ ...form, perKill: event.target.value })} placeholder={`Default: ${getDefaultPerKill(match.mode, form.entryFee)}`} /></label><label>Match description<textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Per kill 20 Rs... or Prize pool 40 Rs..." rows="4" /></label><label>Room ID<input name="roomId" value={form.roomId} onChange={(event) => setForm({ ...form, roomId: event.target.value })} placeholder="Shown to joined players 10 min before start" maxLength={40} /></label><label>Room password<input value={form.roomPassword} onChange={(event) => setForm({ ...form, roomPassword: event.target.value })} placeholder="Room password" maxLength={40} /></label><button type="submit" className={`admin-save-button is-${saveState}`} disabled={saveState === 'saving'} aria-live="polite">{saveButtonLabels[saveState]}</button></form>
      </div>
    </section>
  )
}

function DataTable({ title, columns, rows, onRowClick }) {
  return <section className="admin-table-card"><div className="admin-card-heading"><h2>{title}</h2><span>{rows.length} records</span></div><div className="admin-table-wrap"><table><thead><tr>{columns.map((column) => <th key={column}>{column.replaceAll('_', ' ')}</th>)}</tr></thead><tbody>{rows.length ? rows.map((row, index) => <tr key={`${row.id || row.match_id || row.user_key}-${index}`} className={onRowClick ? 'is-clickable' : ''} onClick={() => onRowClick?.(row)}>{columns.map((column) => <td key={column}>{String(row[column] ?? '-')}</td>)}</tr>) : <tr><td colSpan={columns.length}>No records found.</td></tr>}</tbody></table></div></section>
}

export default AdminPanel
