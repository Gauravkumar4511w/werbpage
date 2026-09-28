import { useEffect, useState } from 'react'
import { DEFAULT_ENTRY_FEES, EDIT_LOCK_MS, MATCH_MODES, getMatchCapacity, getScheduledMatches } from '../../lib/match-schedule.js'
import freeFireMaxIcon from '../assets/image_10d29343.jpg'
import battleRoyalImage from '../assets/battelroyal.png'
import clashSquadImage from '../assets/clashsquad.png'
import loneWolfImage from '../assets/lone wolf.png'

const matchGroups = MATCH_MODES.map((mode) => ({ name: mode, modes: [mode] }))

// Shown until the server catalog loads, or when the API is not deployed. The server assigns match numbers.
function getLocalSchedule() {
  return getScheduledMatches().map((match) => ({ ...match, id: match.id.toLowerCase(), publicId: '', description: '', status: 'open', joinedCount: null }))
}

function fromCatalog(match) {
  return {
    id: String(match.match_id).toLowerCase(),
    publicId: match.public_id ? `#${match.public_id}` : '',
    mode: match.mode,
    description: match.description || '',
    entryFee: Number(match.entry_fee) || DEFAULT_ENTRY_FEES[match.mode],
    matchTimestamp: Number(match.match_timestamp) || 0,
    prizePool: match.prize_pool,
    status: match.status || 'open',
    joinedCount: Number(match.joined_count) || 0,
  }
}

const hour = 60 * 60 * 1000
const scheduleIdPrefix = /^(\d{4}-\d{2}-\d{2}t\d{2}:\d{2}:\d{2}\.\d{3}z)-\d+-/

// Daily matches run until 1:20 AM, so a match belongs to the day its id was scheduled on, not the
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

function getModeFormat(mode) {
  if (mode.includes('1v1')) return '1v1'
  if (mode.includes('2v2')) return 'Duo'
  if (mode.includes('4v4')) return 'Squad'
  return mode.match(/(Solo|Duo|Squad|\d+v\d+)/i)?.[1] || mode
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
  }, [tournamentsOpen])

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
      const matchElement = Array.from(document.querySelectorAll('.scheduled-match')).find((element) => element.dataset.matchId === focusMatchId)
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
      style={expandedMode ? {
        backgroundImage: `linear-gradient(rgba(7,16,27,.68), rgba(7,16,27,.84)), url(${getModeImage(expandedMode)})`,
      } : undefined}
      aria-labelledby="tournament-title"
    >
      <button className="library-back" type="button" onClick={onBack}>&lt;- Back to discover</button>
      <div className="tournament-heading">
        <div><p className="eyebrow"><span></span> Free Fire MAX arena</p><h2 id="tournament-title">LIVE MATCHES.</h2><p>Two matches in every mode, scheduled from 8:00 AM to 11:00 PM.</p></div>
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
            <div className="date-heading"><h3>{day.date}</h3><span>2 matches / mode</span></div>
            {expandedMode && <button className="matches-back" type="button" onClick={() => setExpandedMode(null)}>&lt;- Back to modes</button>}
            {matchGroups.filter((group) => !expandedMode || group.name === expandedMode).map((group) => (
              <section className={`tournament-day match-category${expandedMode === group.name ? ' is-expanded' : ''}`} key={`${day.date}-${group.name}`}>
                <div
                  className={`category-heading${group.name.startsWith('Battle Royale') ? ' mode-battle-royale' : ''}${group.name.startsWith('Clash Squad') ? ' mode-clash-squad' : ''}${group.name === 'Clash Squad 1v1' ? ' mode-one-v-one' : ''}${group.name === 'Lone Wolf 1v1' ? ' mode-lone-wolf' : ''}`}
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
                </div>
                {expandedMode === group.name && <div className="match-grid">
                  {day.matches.filter((match) => group.modes.includes(match.mode)).map((match) => {
                const entryFee = match.entryFee || DEFAULT_ENTRY_FEES[match.mode]
                const matchCapacity = getMatchCapacity(match.mode)
                const joinedEntry = joinedMatches.find((entry) => entry.id === match.id)
                const isJoined = Boolean(joinedEntry)
                const joinedCount = match.joinedCount ?? (isJoined ? 1 : 0)
                const fillPercent = Math.min(100, (joinedCount / matchCapacity.total) * 100)
                const hasStarted = Boolean(match.matchTimestamp) && currentTime >= match.matchTimestamp
                const hasEnded = match.status === 'confirmed'
                const isFull = !isJoined && joinedCount >= matchCapacity.total
                const canEdit = isJoined && currentTime < match.matchTimestamp - EDIT_LOCK_MS
                const isClosed = !isJoined && (hasEnded || hasStarted || isFull)
                const buttonLabel = isJoined ? (canEdit ? 'Edit' : 'Joined') : hasEnded ? 'Ended' : hasStarted ? 'Closed' : isFull ? 'Full' : 'Join'
                const details = { ...match, entryFee, joinedEntry, hasStarted, isFull }

                return (
                  <article
                    className={`scheduled-match${isJoined ? ' is-joined-match' : ''}`}
                    key={match.id}
                    data-match-id={match.id}
                    onClick={() => onMatchDetails(details)}
                    style={{ cursor: 'pointer' }}
                  >
                    {isJoined && <span className="match-joined-light" aria-label="Match joined" />}
                    <img className="match-game-mark" src={freeFireMaxIcon} alt="Free Fire MAX" />
                    <div>
                      <h4>{match.mode}</h4>
                      <p>Free Fire MAX</p>
                    </div>
                    <div className="match-meta">
                      <time>{formatTime(match.matchTimestamp)}</time>
                      <span className="match-entry-fee"><span className="coin-icon" aria-hidden="true"></span>{entryFee} coins</span>
                      <span className={`match-capacity-badge${matchCapacity.unit === 'players' ? ' is-player-count' : ''}`} style={{ '--capacity-fill': `${fillPercent}%` }}>
                        <span>{joinedCount}/{matchCapacity.total} {matchCapacity.unit}</span>
                      </span>
                    </div>
                    <div className="match-action">
                      <span className="match-public-id">{match.publicId}</span>
                      {/* Never disabled for low coins: tapping Join then explains how many coins are missing. */}
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          if (isJoined && !canEdit) onMatchDetails(details)
                          else onJoinMatch(details)
                        }}
                        disabled={isClosed}
                        className={isJoined ? 'joined-button' : ''}
                      >
                        {buttonLabel}
                      </button>
                    </div>
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
