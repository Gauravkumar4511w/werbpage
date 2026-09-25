import { useEffect, useState } from 'react'

const emptyOverview = { users: [], matches: [], entries: [], payments: [], withdrawals: [], kills: [] }
const matchModes = ['Battle Royale Solo', 'Battle Royale Duo', 'Battle Royale Squad', 'Clash Squad 1v1', 'Clash Squad 2v2', 'Clash Squad 4v4', 'Lone Wolf 1v1']
const defaultFees = { 'Battle Royale Solo': 50, 'Battle Royale Duo': 100, 'Battle Royale Squad': 150, 'Clash Squad 1v1': 50, 'Clash Squad 2v2': 100, 'Clash Squad 4v4': 200, 'Lone Wolf 1v1': 75 }

function AdminPanel({ onBack }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [token, setToken] = useState(() => sessionStorage.getItem('arenacore-admin-token') || '')
  const [overview, setOverview] = useState(emptyOverview)
  const [tab, setTab] = useState('overview')
  const [query, setQuery] = useState('')
  const [message, setMessage] = useState('')
  const [creditForm, setCreditForm] = useState({ userKey: '', amount: '', displayName: '' })
  const [killForm, setKillForm] = useState({ matchId: '', userKey: '', kills: '' })
  const [resultForm, setResultForm] = useState({ matchId: '', winnerTeamKey: '' })
  const [matchLookup, setMatchLookup] = useState('')
  const [selectedMatch, setSelectedMatch] = useState(null)
  const [matchForm, setMatchForm] = useState({ entryFee: '', matchTimestamp: '', prizePool: '', description: '' })
  const [createForm, setCreateForm] = useState({ mode: matchModes[0], entryFee: String(defaultFees[matchModes[0]]), matchTimestamp: '', prizePool: '', description: '' })

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
    const data = await response.json().catch(() => ({}))
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
        if (active) setOverview(data)
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

  const login = async (event) => {
    event.preventDefault()
    setLoading(true)
    setMessage('')
    try {
      const data = await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ email: email.trim(), password }) })
      sessionStorage.setItem('arenacore-admin-token', data.token)
      setToken(data.token)
      setMessage('Admin dashboard ready.')
      const response = await fetch('/api/admin/overview', { headers: { Authorization: `Bearer ${data.token}` } })
      const overviewData = await response.json().catch(() => ({}))
      if (response.ok) setOverview(overviewData)
    } catch (error) {
      setMessage(error.message)
    } finally {
      setLoading(false)
    }
  }

  const submitCredit = async (event) => {
    event.preventDefault()
    try {
      await api('/api/admin/users/credit', { method: 'POST', body: JSON.stringify({ ...creditForm, amount: Number(creditForm.amount) }) })
      setCreditForm({ userKey: '', amount: '', displayName: '' })
      setMessage('Credit balance updated.')
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
      matchTimestamp: match.match_timestamp ? new Date(match.match_timestamp).toISOString().slice(0, 16) : '',
      prizePool: match.prize_pool === null ? '' : String(match.prize_pool),
      description: match.description || '',
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
        }),
      })
      setMessage('Match settings updated. Players will see the changes on their next refresh.')
      const freshOverview = await loadOverview()
      const updatedMatch = freshOverview.matches.find((match) => match.match_id === selectedMatch.match_id)
      if (updatedMatch) {
        setSelectedMatch(updatedMatch)
        setMatchForm({
          entryFee: String(updatedMatch.entry_fee),
          matchTimestamp: updatedMatch.match_timestamp ? new Date(updatedMatch.match_timestamp).toISOString().slice(0, 16) : '',
          prizePool: updatedMatch.prize_pool === null ? '' : String(updatedMatch.prize_pool),
          description: updatedMatch.description || '',
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
    if (!selectedMatch || !window.confirm(`Delete match #${selectedMatch.public_id}?`)) return
    try {
      await api('/api/admin/matches/delete', { method: 'DELETE', body: JSON.stringify({ matchId: selectedMatch.public_id }) })
      setSelectedMatch(null)
      setMessage(`Match #${selectedMatch.public_id} deleted.`)
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
  const logout = () => { sessionStorage.removeItem('arenacore-admin-token'); setToken('') }
  const filteredUsers = overview.users.filter(searchable)
  const filteredPayments = overview.payments.filter(searchable)
  const filteredWithdrawals = overview.withdrawals.filter(searchable)
  const filteredMatches = overview.matches.filter(searchable)
  const currentSelectedMatch = selectedMatch
    ? overview.matches.find((match) => match.match_id === selectedMatch.match_id) || selectedMatch
    : null

  return <main className="admin-page"><header className="admin-header"><div><p className="eyebrow"><span /> Secure control room</p><h1>ADMIN DESK.</h1></div><div className="admin-header-actions"><button type="button" onClick={loadOverview}>Refresh</button><button type="button" onClick={logout}>Sign out</button><button type="button" onClick={onBack}>Exit</button></div></header><div className="admin-summary"><div><span>Users</span><strong>{overview.users.length}</strong></div><div><span>Payments</span><strong>{overview.payments.filter((item) => item.status === 'pending').length}</strong><small>pending review</small></div><div><span>Withdrawals</span><strong>{overview.withdrawals.filter((item) => item.status === 'pending').length}</strong><small>pending review</small></div><div><span>Matches</span><strong>{overview.matches.length}</strong></div></div><div className="admin-toolbar"><nav>{['overview', 'payments', 'withdrawals', 'matches', 'users'].map((item) => <button key={item} className={tab === item ? 'selected' : ''} type="button" onClick={() => setTab(item)}>{item}</button>)}</nav><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search user, match, UTR..." /></div>{message && <p className="admin-message">{message}</p>}

    {tab === 'overview' && <div className="admin-grid"><section className="admin-card"><h2>Add credit coins</h2><p>Use this for verified manual adjustments only.</p><form onSubmit={submitCredit}><input placeholder="User email / phone" value={creditForm.userKey} onChange={(event) => setCreditForm({ ...creditForm, userKey: event.target.value })} required /><input placeholder="Display name" value={creditForm.displayName} onChange={(event) => setCreditForm({ ...creditForm, displayName: event.target.value })} /><input type="number" placeholder="+ coins or - coins" value={creditForm.amount} onChange={(event) => setCreditForm({ ...creditForm, amount: event.target.value })} required /><button type="submit">Save credit balance</button></form></section><section className="admin-card"><h2>Record kills</h2><p>Save the final kill count before confirming a result.</p><form onSubmit={submitKills}><input placeholder="Match ID" value={killForm.matchId} onChange={(event) => setKillForm({ ...killForm, matchId: event.target.value })} required /><input placeholder="User email / phone" value={killForm.userKey} onChange={(event) => setKillForm({ ...killForm, userKey: event.target.value })} required /><input type="number" min="0" placeholder="Kills" value={killForm.kills} onChange={(event) => setKillForm({ ...killForm, kills: event.target.value })} required /><button type="submit">Save kills</button></form></section><section className="admin-card"><h2>Confirm winner</h2><p>Once confirmed, the 80% winnings payout cannot be duplicated.</p><form onSubmit={submitResult}><input placeholder="Match ID" value={resultForm.matchId} onChange={(event) => setResultForm({ ...resultForm, matchId: event.target.value })} required /><input placeholder="Winning team key" value={resultForm.winnerTeamKey} onChange={(event) => setResultForm({ ...resultForm, winnerTeamKey: event.target.value })} required /><button type="submit">Confirm result and payout</button></form></section></div>}
    {tab === 'payments' && <DataTable title="Payment requests" columns={['user_key', 'amount', 'coins', 'utr', 'status', 'created_at']} rows={filteredPayments} />}
    {tab === 'withdrawals' && <DataTable title="Withdrawal requests" columns={['user_key', 'amount', 'method', 'details', 'status', 'created_at']} rows={filteredWithdrawals} />}
    {tab === 'matches' && <>
      <section className="admin-card admin-create-match"><h2>Create new match</h2><p>Select any available mode, choose its time, and publish a custom prize.</p><form className="admin-create-form" onSubmit={submitCreateMatch}><label>Mode<select value={createForm.mode} onChange={(event) => setCreateForm({ ...createForm, mode: event.target.value, entryFee: String(defaultFees[event.target.value]) })}>{matchModes.map((mode) => <option key={mode} value={mode}>{mode}</option>)}</select></label><label>Entry fee<input type="number" min="1" value={createForm.entryFee} onChange={(event) => setCreateForm({ ...createForm, entryFee: event.target.value })} required /></label><label>Date and time<input type="datetime-local" value={createForm.matchTimestamp} onChange={(event) => setCreateForm({ ...createForm, matchTimestamp: event.target.value })} required /></label><label>Prize pool<input type="number" min="0" value={createForm.prizePool} onChange={(event) => setCreateForm({ ...createForm, prizePool: event.target.value })} placeholder="Optional" /></label><label>Description<textarea value={createForm.description} onChange={(event) => setCreateForm({ ...createForm, description: event.target.value })} placeholder="Per kill 20 Rs..." rows="3" /></label><button type="submit">Create match</button></form></section>
      <section className="admin-card admin-match-lookup"><h2>Match control</h2><p>Enter a public ID such as #000001 to inspect players and edit settings.</p><div className="admin-lookup-row"><input value={matchLookup} onChange={(event) => setMatchLookup(event.target.value)} placeholder="#000001" /><button type="button" onClick={() => selectMatch(matchLookup)}>Open match</button></div></section>
      {currentSelectedMatch && <MatchControl match={currentSelectedMatch} entries={overview.entries.filter((entry) => entry.match_id === currentSelectedMatch.match_id)} kills={overview.kills.filter((item) => item.match_id === currentSelectedMatch.match_id)} form={matchForm} setForm={setMatchForm} onSubmit={submitMatchUpdate} onDelete={deleteSelectedMatch} />}
      <DataTable title="Registered matches" columns={['public_id', 'mode', 'entry_fee', 'team_count', 'match_timestamp', 'prize_pool', 'status', 'winner_team_key']} rows={filteredMatches} onRowClick={(row) => selectMatch(row.public_id || row.match_id)} />
    </>}
    {tab === 'users' && <DataTable title="User balances" columns={['user_key', 'display_name', 'credit_coins', 'winning_coins', 'created_at']} rows={filteredUsers} />}
  </main>
}

function MatchControl({ match, entries, kills, form, setForm, onSubmit, onDelete }) {
  return <section className="admin-match-control"><div className="admin-card-heading"><div><h2>#{match.public_id || '------'} · {match.mode || 'Match'}</h2><span>{match.status} · {entries.length} joined players</span></div><button className="admin-delete-button" type="button" onClick={onDelete}>Delete match</button></div><div className="admin-match-columns"><div><h3>Joined players</h3><div className="admin-player-list">{entries.length ? entries.map((entry) => <div key={`${entry.team_key}-${entry.user_key}`}><strong>{entry.team_key}</strong><span>{entry.user_key}</span><small>{kills.find((item) => item.user_key === entry.user_key)?.kills || 0} kills</small></div>) : <p>No players recorded.</p>}</div></div><form className="admin-match-form" onSubmit={onSubmit}><label>Entry fee<input type="number" min="1" value={form.entryFee} onChange={(event) => setForm({ ...form, entryFee: event.target.value })} required /></label><label>Match time<input type="datetime-local" value={form.matchTimestamp} onChange={(event) => setForm({ ...form, matchTimestamp: event.target.value })} /></label><label>Prize payout override<input type="number" min="0" value={form.prizePool} onChange={(event) => setForm({ ...form, prizePool: event.target.value })} placeholder="Default: 80% pool" /></label><label>Match description<textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Per kill 20 Rs... or Prize pool 40 Rs..." rows="4" /></label><button type="submit">Save match changes</button></form></div></section>
}

function DataTable({ title, columns, rows, onRowClick }) {
  return <section className="admin-table-card"><div className="admin-card-heading"><h2>{title}</h2><span>{rows.length} records</span></div><div className="admin-table-wrap"><table><thead><tr>{columns.map((column) => <th key={column}>{column.replaceAll('_', ' ')}</th>)}</tr></thead><tbody>{rows.length ? rows.map((row, index) => <tr key={`${row.id || row.match_id || row.user_key}-${index}`} onClick={() => onRowClick?.(row)}>{columns.map((column) => <td key={column}>{String(row[column] ?? '-')}</td>)}</tr>) : <tr><td colSpan={columns.length}>No records found.</td></tr>}</tbody></table></div></section>
}

export default AdminPanel
