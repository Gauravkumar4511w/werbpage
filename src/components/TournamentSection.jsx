import { useEffect, useState } from 'react'
import { DEFAULT_ENTRY_FEES, EDIT_LOCK_MS, MATCH_MODES, getEntryCost, formatMatchNo, getMatchCapacity, getPerKillCoins, getScheduledMatches, getWinningCoins } from '../../lib/match-schedule.js'
import freeFireMaxIcon from '../assets/hero-banner.jpg'
import battleRoyalImage from '../assets/battelroyal.jpg'
import clashSquadImage from '../assets/clashsquad.jpg'
import loneWolfImage from '../assets/lone-wolf.jpg'
import { formatStartsIn, getModeFamily, getModeFormat } from '../matchTheme.js'

const matchGroups = MATCH_MODES.map((mode) => ({ name: mode, modes: [mode] }))

// Shown until the server catalog loads, or when the API is not deployed. The server assigns match numbers.
function getLocalSchedule() {
  return getScheduledMatches().map((match) => ({ ...match, id: match.id.toLowerCase(), publicId: '', description: '', status: 'open', joinedCount: null }))
}

function fromCatalog(match) {
  return {
    id: String(match.match_id).toLowerCase(),
    publicId: formatMatchNo(match.day_no) || (match.public_id ? `#${match.public_id}` : ''),
    mode: match.mode,
    description: match.description || '',
    entryFee: Number(match.entry_fee) || DEFAULT_ENTRY_FEES[match.mode],
    freeEntry: Number(match.free_entry) === 1,
    matchTimestamp: Number(match.match_timestamp) || 0,
    prizePool: match.prize_pool,
    perKill: match.per_kill,
    status: match.status || 'open',
    joinedCount: Number(match.joined_count) || 0,
  }
}

const hour = 60 * 60 * 1000
const scheduleIdPrefix = /^(\d{4}-\d{2}-\d{2}t\d{2}:\d{2}:\d{2}\.\d{3}z)-\d+-/

// Daily matches used to run until 1:20 AM, so a match belongs to the day its id was scheduled on, not the
// calendar day it starts. Admin-created matches use their start time.
function getScheduleDay(match) {
  const prefix = match.id.match(scheduleIdPrefix)?.[1]
  return new Date(prefix ? Date.parse(prefix.toUpperCase()) + 12 * hour : match.matchTimestamp)
}

// Shows each day that has a match from the last 3 hours up to 12 hours ahead, so tomorrow appears in the evening.
function groupByDay(matches, now) {
  const days = new Map()
  matches.filter((match) => match.mode && match.matchTimestamp).forEach((match) => {
    const date = getScheduleDay(match)
    const key = date.toDateString()
    if (!days.has(key)) days.set(key, { key, start: new Date(date).setHours(0, 0, 0, 0), date: date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }), matches: [] })
    days.get(key).matches.push(match)
  })
  return [...days.values()]
    .filter((day) => day.matches.some((match) => match.matchTimestamp >= now - 3 * hour && match.matchTimestamp <= now + 12 * hour))
    .sort((a, b) => a.start - b.start)
    .map((day) => ({ ...day, matches: [...day.matches].sort((a, b) => a.matchTimestamp - b.matchTimestamp) }))
}

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })
}

// A small mark per mode family, drawn before the card title.
function ModeGlyph({ family }) {
  if (family === 'cs') {
    return <svg className="match-card-glyph" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5 4 5.6v6.1c0 4.6 3.3 8.6 8 9.8 4.7-1.2 8-5.2 8-9.8V5.6L12 2.5Z" /><path d="m8.5 12.2 2.3 2.3 4.7-4.9" /></svg>
  }
  if (family === 'lw') {
    return <svg className="match-card-glyph" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 3.5 8.5 8h7L20 3.5V13l-8 7.5L4 13V3.5Z" /><path d="M9.2 12.3h.01M14.8 12.3h.01" /></svg>
  }
  return <svg className="match-card-glyph" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7.5" /><path d="M12 2v5M12 17v5M2 12h5M17 12h5" /><circle cx="12" cy="12" r="1.4" /></svg>
}

function TeamPips({ size }) {
  return (
    <span className="match-card-pips" aria-label={`${size} ${size === 1 ? 'player' : 'players'} per team`}>
      {Array.from({ length: size }, (_, index) => <i key={index} />)}
    </span>
  )
}

function getModeImage(mode) {
  if (mode?.startsWith('Battle Royale')) return battleRoyalImage
  if (mode?.startsWith('Clash Squad')) return clashSquadImage
  if (mode === 'Lone Wolf 1v1') return loneWolfImage
  return freeFireMaxIcon
}

function TournamentSection({ tournamentsOpen, onBack, joinedMatches, onJoinMatch, onMatchDetails, focusMatchId }) {
  const [currentTime, setCurrentTime] = useState(() => Date.now())
  const [catalog, setCatalog] = useState(null)
  const [localSchedule] = useState(getLocalSchedule)
  const visibleSchedule = groupByDay(catalog || localSchedule, currentTime)
  const [liveOpen, setLiveOpen] = useState(false)
  const [expandedMode, setExpandedMode] = useState(null)

  useEffect(() => {
    const refreshTimer = window.setInterval(() => setCurrentTime(Date.now()), 10000)
    return () => window.clearInterval(refreshTimer)
  }, [])

  // Joining changes a match's player count, so the catalog is fetched again straight away.
  const joinedTotal = joinedMatches.length

  // The server catalog is the source of truth: match numbers, fees, times, deletions and joined counts.
  useEffect(() => {
    if (!tournamentsOpen) return undefined
    let active = true
    let timer
    const refreshCatalog = async () => {
      try {
        const response = await fetch('/api/matches/catalog')
        if (response.status === 404) {
          // The catalog API is not deployed here; stop polling instead of logging a 404 every 5 seconds.
          window.clearInterval(timer)
          return
        }
        if (!response.ok) return
        const data = await response.json()
        if (active && Array.isArray(data.matches)) setCatalog(data.matches.map(fromCatalog))
      } catch {
        // Keep the last schedule available when the API is offline.
      }
    }
    timer = window.setInterval(refreshCatalog, 5000)
    refreshCatalog()
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [tournamentsOpen, joinedTotal])

  const toggleMatches = (mode) => {
    setExpandedMode((currentMode) => currentMode === mode ? null : mode)
  }

  useEffect(() => {
    if (!focusMatchId || !tournamentsOpen) return
    const focusedMatch = joinedMatches.find((match) => match.id === focusMatchId)
    const mode = focusedMatch?.mode || MATCH_MODES.find((candidate) => focusMatchId.endsWith(`-${candidate.toLowerCase()}`))
    if (!mode) return
    const expandTimer = window.setTimeout(() => setExpandedMode(mode), 0)
    const scrollTimer = window.setTimeout(() => {
      const matchElement = Array.from(document.querySelectorAll('.match-card')).find((element) => element.dataset.matchId === focusMatchId)
      matchElement?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 80)
    return () => {
      window.clearTimeout(expandTimer)
      window.clearTimeout(scrollTimer)
    }
  }, [focusMatchId, joinedMatches, tournamentsOpen])

  return (
    <section
      className={`tournament-section${tournamentsOpen ? ' is-visible' : ''}${expandedMode ? ' has-expanded-mode' : ''}`}
      aria-labelledby="tournament-title"
    >
      <button className="library-back" type="button" onClick={onBack}>&lt;- Back to discover</button>
      <div className="tournament-heading">
        <div><p className="eyebrow"><span></span> Free Fire MAX arena</p><h2 id="tournament-title">LIVE MATCHES.</h2><p>A match every hour from 9:00 AM to 1:00 AM: three in a row for each Battle Royale mode, two for the others.</p></div>
        <button className="tournament-badge" type="button" onClick={() => setLiveOpen((open) => !open)} aria-expanded={liveOpen}><span></span> LIVE SCHEDULE</button>
      </div>
      {liveOpen ? (
        <div className="tournament-coming-soon" role="status">
          <strong>COMING SOON.</strong>
          <span>Live match broadcasts will be available here soon.</span>
          <button type="button" onClick={() => setLiveOpen(false)}>View schedule</button>
        </div>
      ) : <div className="tournament-days">
        {visibleSchedule.map((day) => (
          <div className={`tournament-date-group${expandedMode ? ' is-detail-view' : ''}`} key={day.key}>
            <div className="date-heading"><h3>{day.date}</h3><span>A match every hour</span></div>
            {expandedMode && <button className="matches-back" type="button" onClick={() => setExpandedMode(null)}>&lt;- Back to modes</button>}
            {matchGroups.filter((group) => !expandedMode || group.name === expandedMode).map((group) => (
              <section className={`tournament-day match-category${expandedMode === group.name ? ' is-expanded' : ''}`} key={`${day.date}-${group.name}`}>
                {/* Once a mode is open its cards say which mode it is, so the big banner is left out. */}
                {expandedMode !== group.name && <div
                  className={`category-heading theme-${getModeFamily(group.name).key}${group.name.startsWith('Battle Royale') ? ' mode-battle-royale' : ''}${group.name.startsWith('Clash Squad') ? ' mode-clash-squad' : ''}${group.name === 'Clash Squad 1v1' ? ' mode-one-v-one' : ''}${group.name === 'Lone Wolf 1v1' ? ' mode-lone-wolf' : ''}`}
                  style={{
                    backgroundImage: `url(${getModeImage(group.name)})`,
                    backgroundPosition: 'center',
                  }}
                  onClick={() => toggleMatches(group.name)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      toggleMatches(group.name)
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  aria-expanded={expandedMode === group.name}
                >
                  {day.matches.some((match) => group.modes.includes(match.mode) && joinedMatches.some((entry) => entry.id === match.id)) && <span className="mode-status-light" aria-label="Match joined" />}
                  <span className="mode-format-label">
                    {getModeFormat(group.name)}
                  </span>
                  {(() => {
                    const modeMatches = day.matches.filter((match) => group.modes.includes(match.mode))
                    const next = modeMatches.find((match) => match.matchTimestamp > currentTime)
                    return (
                      <span className={`mode-tile-info theme-${getModeFamily(group.name).key}`}>
                        <strong>{group.name}</strong>
                        <small>{next ? `Next ${formatTime(next.matchTimestamp)}` : 'Done for today'} · {modeMatches.length} {modeMatches.length === 1 ? 'match' : 'matches'}</small>
                      </span>
                    )
                  })()}
                </div>}
                {expandedMode === group.name && <div className="match-grid">
                  {day.matches.filter((match) => group.modes.includes(match.mode)).map((match) => {
                const entryFee = match.entryFee || DEFAULT_ENTRY_FEES[match.mode]
                const matchCapacity = getMatchCapacity(match.mode)
                const winning = getWinningCoins({ mode: match.mode, entryFee, prizePool: match.prizePool })
                const perKill = getPerKillCoins({ mode: match.mode, entryFee, perKill: match.perKill })
                const joinedEntry = joinedMatches.find((entry) => entry.id === match.id)
                const isJoined = Boolean(joinedEntry)
                const joinedCount = match.joinedCount ?? (isJoined ? 1 : 0)
                const fillPercent = Math.min(100, (joinedCount / matchCapacity.total) * 100)
                const hasStarted = Boolean(match.matchTimestamp) && currentTime >= match.matchTimestamp
                const hasEnded = match.status === 'confirmed'
                const isFull = !isJoined && joinedCount >= matchCapacity.total
                const canEdit = isJoined && !hasEnded && currentTime < match.matchTimestamp - EDIT_LOCK_MS
                const isClosed = !isJoined && (hasEnded || hasStarted || isFull)
                // A started match reads Live for its first 3 hours, then Played once its time is over.
                const isLive = hasStarted && !hasEnded && currentTime < match.matchTimestamp + 3 * hour
                const buttonLabel = isJoined ? (canEdit ? 'Edit' : 'Joined') : isLive ? 'Live' : hasEnded || hasStarted ? 'Played' : isFull ? 'Full' : 'Join'
                const cost = getEntryCost({ entryFee, freeEntry: match.freeEntry })
                const details = { ...match, entryFee, cost, joinedEntry, hasStarted, isFull }
                const family = getModeFamily(match.mode)
                const status = isJoined ? { tone: 'joined', label: 'Joined' }
                  : isLive ? { tone: 'live', label: 'Live' }
                  : hasEnded || hasStarted ? { tone: 'ended', label: 'Played' }
                  : isFull ? { tone: 'full', label: 'Full' }
                  : fillPercent >= 60 ? { tone: 'hot', label: 'Filling fast' }
                  : { tone: 'open', label: 'Open' }
                const startsIn = match.matchTimestamp - currentTime
                const stats = [
                  winning > 0 && { label: 'Win prize', value: winning.toLocaleString(), coin: true },
                  perKill > 0 && { label: 'Per kill', value: perKill, coin: true },
                ].filter(Boolean)

                return (
                  <article
                    className={`match-card theme-${family.key} is-${status.tone}`}
                    key={match.id}
                    data-match-id={match.id}
                    onClick={() => onMatchDetails(details)}
                  >
                    <span className="match-card-watermark" aria-hidden="true">{getModeFormat(match.mode)}</span>
                    <header className="match-card-top">
                      <div className="match-card-tags">
                        <span className="match-card-tag is-accent">{getModeFormat(match.mode)}</span>
                        <span className="match-card-tag">{family.tag}</span>
                        {match.freeEntry && <span className="match-card-tag is-free">Free entry</span>}
                      </div>
                      <span className={`match-card-status is-${status.tone}`}>{status.label}</span>
                    </header>
                    <h4><ModeGlyph family={family.key} />{match.mode}</h4>
                    <p className="match-card-sub">Free Fire MAX{match.publicId && <> · <b>{match.publicId}</b></>}</p>
                    <div className="match-card-fill">
                      <span className="match-card-bar"><i style={{ width: `${fillPercent}%` }} /></span>
                      <span className="match-card-count"><b>{joinedCount}</b>/{matchCapacity.total} {matchCapacity.unit}</span>
                    </div>
                    <dl className="match-card-stats">
                      <div>
                        <dt>Time</dt>
                        <dd>{formatTime(match.matchTimestamp)}</dd>
                        <small>{hasEnded ? 'Result out' : isLive ? 'Live now' : hasStarted ? 'Played' : formatStartsIn(startsIn)}</small>
                      </div>
                      {stats.map((stat) => (
                        <div key={stat.label}>
                          <dt>{stat.label}</dt>
                          <dd>{stat.coin && <span className="coin-icon" aria-hidden="true"></span>}{stat.value}</dd>
                          <small>coins</small>
                        </div>
                      ))}
                      <div>
                        <dt>Team</dt>
                        <dd><TeamPips size={matchCapacity.teamSize} /></dd>
                        <small>{matchCapacity.teamSize === 1 ? 'Solo' : `${matchCapacity.teamSize} players`}</small>
                      </div>
                    </dl>
                    {/* Never disabled for low coins: tapping Join then explains how many coins are missing. */}
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        if (isJoined && !canEdit) onMatchDetails(details)
                        else onJoinMatch(details)
                      }}
                      disabled={isClosed}
                      className={`match-card-join${isJoined ? ' joined-button' : ''}`}
                    >
                      {!isJoined && !isClosed && (cost > 0
                        ? <><span className="match-card-coin" aria-hidden="true"></span><span className="match-card-fee">{cost}</span></>
                        : <span className="match-card-free">FREE</span>)}
                      <span>{buttonLabel === 'Join' ? (cost > 0 ? 'Join now' : 'Join free') : buttonLabel}</span>
                    </button>
                  </article>
                  )})}
                </div>}
              </section>
            ))}
          </div>
        ))}
      </div>}
    </section>
  )
}

export default TournamentSection
