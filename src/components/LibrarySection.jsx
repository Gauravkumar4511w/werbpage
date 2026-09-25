import { useEffect, useState } from 'react'

const knownModes = ['Battle Royale Solo', 'Battle Royale Duo', 'Battle Royale Squad', 'Clash Squad 1v1', 'Clash Squad 2v2', 'Clash Squad 4v4', 'Lone Wolf 1v1']

function getMatchMode(match) {
  return match.mode || knownModes.find((mode) => String(match.id || '').endsWith(`-${mode}`)) || 'Joined match'
}

function getMatchTimestamp(match) {
  const storedTimestamp = Number(match.matchTimestamp || 0)
  if (storedTimestamp > 0) return storedTimestamp

  const matchId = String(match.id || '')
  const mode = getMatchMode(match)
  const modeStart = matchId.lastIndexOf(`-${mode}`)
  const minutes = Number(matchId.slice(25, modeStart))
  const date = new Date(`${matchId.slice(0, 10)}T00:00:00`)
  if (!Number.isFinite(minutes) || Number.isNaN(date.getTime())) return 0
  date.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0)
  return date.getTime()
}

function LibrarySection({ libraryOpen, matchHistory, joinedMatches, onBack, onOpenJoinedMatch }) {
  const [currentTime, setCurrentTime] = useState(() => Date.now())

  useEffect(() => {
    const refreshTimer = window.setInterval(() => setCurrentTime(Date.now()), 30000)
    return () => window.clearInterval(refreshTimer)
  }, [])

  const playedJoinedMatches = joinedMatches.filter((match) => getMatchTimestamp(match) > 0 && getMatchTimestamp(match) <= currentTime)
  const upcomingJoinedMatches = joinedMatches.filter((match) => getMatchTimestamp(match) === 0 || getMatchTimestamp(match) > currentTime)

  return (
    <section className={`library-section${libraryOpen ? ' is-visible' : ''}`} id="library" aria-labelledby="library-title">
      <button className="library-back" type="button" onClick={onBack}>&lt;- Back to discover</button>
      <div className="section-heading">
        <div><p className="eyebrow"><span></span> Your activity</p><h2 id="library-title">MATCH HISTORY.</h2></div>
        <p>{playedJoinedMatches.length + matchHistory.length} played {playedJoinedMatches.length + matchHistory.length === 1 ? 'match' : 'matches'}</p>
      </div>
      <div className="history-sections">
        {upcomingJoinedMatches.length > 0 && <div className="history-group">
          <h3 className="history-group-title">JOINED MATCHES</h3>
          <div className="match-history-list">
            {upcomingJoinedMatches.map((match) => (
              <article className="match-history-row joined-history-row" key={`joined-${match.id}`} onClick={() => onOpenJoinedMatch(match)} role="button" tabIndex={0}>
                <div className="match-game-mark">FF</div>
                <div><h3>{getMatchMode(match)}</h3><p>Free Fire MAX · Joined match</p></div>
                <strong className="victory">JOINED</strong>
                <span>{match.identifier || 'Players confirmed'}</span>
              </article>
            ))}
          </div>
        </div>}
        {(playedJoinedMatches.length > 0 || matchHistory.length > 0) && <div className="history-group">
          <h3 className="history-group-title">PLAYED MATCHES</h3>
          <div className="match-history-list">
            {playedJoinedMatches.map((match) => (
              <article className="match-history-row" key={`played-joined-${match.id}`}>
                <div className="match-game-mark">FF</div>
                <div><h3>{getMatchMode(match)}</h3><p>Free Fire MAX · Match completed</p></div>
                <strong className="victory">PLAYED</strong>
                <span>{match.identifier || 'Players confirmed'}</span>
              </article>
            ))}
            {matchHistory.map((match) => (
              <article className="match-history-row" key={match.id}><div className="match-game-mark">FF</div><div><h3>{match.mode}</h3><p>Free Fire MAX · {match.date}</p></div><strong className={match.result === 'Victory' ? 'victory' : 'defeat'}>{match.result}</strong><span>{match.score}</span></article>
            ))}
          </div>
        </div>}
      </div>
      {matchHistory.length === 0 && joinedMatches.length === 0 && <div className="empty-library"><strong>No matches yet.</strong><span>Your joined and played matches will appear here.</span></div>}
    </section>
  )
}

export default LibrarySection
