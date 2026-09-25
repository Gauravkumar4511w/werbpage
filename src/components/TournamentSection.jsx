import { useEffect, useState } from 'react'
import freeFireMaxIcon from '../assets/image_10d29343.jpg'
import battleRoyalImage from '../assets/battelroyal.png'
import clashSquadImage from '../assets/clashsquad.png'
import loneWolfImage from '../assets/lone wolf.png'

const modes = ['Battle Royale Solo', 'Battle Royale Duo', 'Battle Royale Squad', 'Clash Squad 1v1', 'Clash Squad 2v2', 'Clash Squad 4v4', 'Lone Wolf 1v1']

const entryFees = {
  'Battle Royale Solo': 50,
  'Battle Royale Duo': 100,
  'Battle Royale Squad': 150,
  'Clash Squad 1v1': 50,
  'Clash Squad 2v2': 100,
  'Clash Squad 4v4': 200,
  'Lone Wolf 1v1': 75,
}

const matchGroups = [
  ...modes.map((mode) => ({ name: mode, modes: [mode] })),
]

function getSchedule() {
  const schedule = []
  const today = new Date()

  for (let dayIndex = 0; dayIndex < 5; dayIndex += 1) {
    const date = new Date(today)
    date.setHours(0, 0, 0, 0)
    date.setDate(today.getDate() + dayIndex)

    const matches = [0, 1].flatMap((round) => modes.map((mode, modeIndex) => {
      const minutes = 8 * 60 + (round * modes.length + modeIndex) * 80
      const matchDate = new Date(date)
      matchDate.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0)
        const matchNumber = dayIndex * 2 * modes.length + round * modes.length + modeIndex + 1

      return {
        id: `${date.toISOString()}-${minutes}-${mode}`,
          publicId: `#${String(matchNumber).padStart(6, '0')}`,
          description: '',
        mode,
        minutes,
        matchNumber: round + 1,
        matchTimestamp: matchDate.getTime(),
      }
    }))

    schedule.push({
      date: date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }),
      matches,
    })
  }

  return schedule
}

function formatTime(minutes) {
  const hour = Math.floor(minutes / 60)
  const displayMinutes = String(minutes % 60).padStart(2, '0')
  const suffix = hour >= 12 ? 'PM' : 'AM'
  const displayHour = hour % 12 || 12
  return `${displayHour}:${displayMinutes} ${suffix}`
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

function getMatchCapacity(mode) {
  if (mode === 'Battle Royale Solo') return { total: 48, unit: 'players', teamSize: 1 }
  if (mode === 'Battle Royale Duo') return { total: 24, unit: 'teams', teamSize: 2 }
  if (mode === 'Battle Royale Squad') return { total: 12, unit: 'teams', teamSize: 4 }
  if (mode === 'Clash Squad 4v4') return { total: 2, unit: 'teams', teamSize: 4 }
  if (mode === 'Clash Squad 2v2') return { total: 2, unit: 'teams', teamSize: 2 }
  if (mode === 'Clash Squad 1v1') return { total: 2, unit: 'teams', teamSize: 1 }
  return { total: 2, unit: 'teams', teamSize: 1 }
}

function TournamentSection({ tournamentsOpen, onBack, joinedMatches, onJoinMatch, onMatchDetails, coinBalance, focusMatchId }) {
  const [currentTime, setCurrentTime] = useState(() => Date.now())
  const [schedule, setSchedule] = useState(getSchedule)
  const visibleSchedule = schedule.filter((day) => {
    const nextWindow = currentTime + 12 * 60 * 60 * 1000
    return day.matches.some((match) => (match.matchTimestamp || 0) <= nextWindow)
  })
  const [liveOpen, setLiveOpen] = useState(false)
  const [expandedMode, setExpandedMode] = useState(null)

  useEffect(() => {
    const refreshTimer = window.setInterval(() => setCurrentTime(Date.now()), 10000)
    return () => window.clearInterval(refreshTimer)
  }, [])

  useEffect(() => {
    if (!tournamentsOpen) return undefined
    const refreshMatchSettings = async () => {
      try {
        const response = await fetch('/api/matches/catalog')
        if (!response.ok) return
        const data = await response.json()
        const settings = new Map(data.matches.map((match) => [match.match_id, match]))
        setSchedule((currentSchedule) => {
          const knownIds = new Set(currentSchedule.flatMap((day) => day.matches.map((match) => match.id.toLowerCase())))
          const nextSchedule = currentSchedule.map((day) => ({
            ...day,
            matches: day.matches.map((match) => {
              const saved = settings.get(match.id.toLowerCase())
              return saved ? { ...match, description: saved.description || '', entryFee: saved.entry_fee || entryFees[match.mode], matchTimestamp: saved.match_timestamp || match.matchTimestamp, prizePool: saved.prize_pool } : match
            }),
          }))
          data.matches.filter((match) => !knownIds.has(match.match_id.toLowerCase()) && match.mode).forEach((match) => {
            const timestamp = Number(match.match_timestamp) || Date.now()
            const date = new Date(timestamp)
            const dateLabel = date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
            const customMatch = { id: match.match_id, publicId: `#${match.public_id}`, description: match.description || '', mode: match.mode, minutes: date.getHours() * 60 + date.getMinutes(), matchNumber: 1, matchTimestamp: timestamp, entryFee: match.entry_fee, prizePool: match.prize_pool }
            const day = nextSchedule.find((item) => item.date === dateLabel)
            if (day) day.matches.push(customMatch)
            else nextSchedule.push({ date: dateLabel, matches: [customMatch] })
          })
          return nextSchedule
        })
      } catch {
        // Keep the local schedule available when the API is offline.
      }
    }
    refreshMatchSettings()
    const timer = window.setInterval(refreshMatchSettings, 5000)
    return () => window.clearInterval(timer)
  }, [tournamentsOpen])

  const canEditMatch = (match) => currentTime < (match.matchTimestamp || 0) - 3600000
  const toggleMatches = (mode) => {
    setExpandedMode((currentMode) => currentMode === mode ? null : mode)
  }

  useEffect(() => {
    if (!focusMatchId || !tournamentsOpen) return
    const focusedMatch = joinedMatches.find((match) => match.id === focusMatchId)
    const mode = focusedMatch?.mode || modes.find((candidate) => focusMatchId.endsWith(`-${candidate}`))
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
          <div className={`tournament-date-group${expandedMode ? ' is-detail-view' : ''}`} key={day.date}>
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
                const entryFee = match.entryFee || entryFees[match.mode]
                const matchCapacity = getMatchCapacity(match.mode)
                const joinedPlayerCount = joinedMatches
                  .filter((entry) => entry.id === match.id)
                  .reduce((total, entry) => total + (entry.identifiers?.filter(Boolean).length || (entry.identifier ? 1 : 0)), 0)
                const joinedTeamCount = joinedMatches
                  .filter((entry) => entry.id === match.id)
                  .filter((entry) => (entry.identifiers?.filter(Boolean).length || (entry.identifier ? 1 : 0)) >= matchCapacity.teamSize).length
                const joinedCount = matchCapacity.teamSize === 1 ? joinedPlayerCount : joinedTeamCount
                const fillPercent = Math.min(100, (joinedCount / matchCapacity.total) * 100)
                const joinedEntry = joinedMatches.find((entry) => entry.id === match.id)
                const canEdit = Boolean(joinedEntry) && canEditMatch({ ...match, matchTimestamp: Number(match.matchTimestamp || joinedEntry?.matchTimestamp || 0) })
                const isJoined = Boolean(joinedEntry)
                const buttonLabel = isJoined ? (canEdit ? 'Edit' : 'Joined') : 'Join'

                return (
                  <article
                    className={`scheduled-match${isJoined ? ' is-joined-match' : ''}`}
                    key={match.id}
                    data-match-id={match.id}
                    onClick={() => onMatchDetails({
                      ...match,
                      entryFee,
                      matchTimestamp: Number(match.matchTimestamp || joinedEntry?.matchTimestamp || 0),
                      joinedEntry,
                      roomId: `FF-${String(match.id).slice(-6)}`,
                      password: `pw${String(match.id).slice(-4)}`,
                    })}
                    style={{ cursor: 'pointer' }}
                  >
                    {isJoined && <span className="match-joined-light" aria-label="Match joined" />}
                    <img className="match-game-mark" src={freeFireMaxIcon} alt="Free Fire MAX" />
                    <div>
                      <h4>{match.mode}</h4>
                      <p>Free Fire MAX</p>
                    </div>
                    <div className="match-meta">
                      <time>{formatTime(match.minutes)}</time>
                      <span className="match-entry-fee"><span className="coin-icon" aria-hidden="true"></span>{entryFee} coins</span>
                      <span className={`match-capacity-badge${matchCapacity.unit === 'players' ? ' is-player-count' : ''}`} style={{ '--capacity-fill': `${fillPercent}%` }}>
                        <span>{joinedCount}/{matchCapacity.total} {matchCapacity.unit}</span>
                      </span>
                    </div>
                    <div className="match-action">
                      <span className="match-public-id">{match.publicId}</span>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          onJoinMatch({
                            ...match,
                            entryFee,
                            matchTimestamp: Number(match.matchTimestamp || joinedEntry?.matchTimestamp || 0),
                            joinedEntry,
                          })
                        }}
                        disabled={(!canEdit && isJoined) || (!isJoined && coinBalance < entryFee)}
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
