import { useState } from 'react'
import { EDIT_LOCK_MS } from '../../lib/match-schedule.js'
import { formatWhen, matchState } from '../myMatches.js'

function CopyValue({ label, value }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="room-value">
      <span>{label}</span>
      <strong>{value || '-'}</strong>
      {value && <button type="button" onClick={() => navigator.clipboard?.writeText(value).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500) })}>{copied ? 'Copied' : 'Copy'}</button>}
    </div>
  )
}

function MyMatchesSection({ joinedMatches, currentTime, onBack, onBrowseMatches, onOpenDetails, onEditNames }) {
  const sorted = [...joinedMatches].sort((a, b) => (Number(a.matchTimestamp) || Infinity) - (Number(b.matchTimestamp) || Infinity))
  const withState = sorted.map((match) => ({ match, state: matchState(match, currentTime) }))
  const active = withState.filter(({ state }) => state.group === 'active')
  const past = withState.filter(({ state }) => state.group === 'past').reverse()

  return (
    <section className="library-section my-matches is-visible" aria-labelledby="my-matches-title">
      <button className="library-back" type="button" onClick={onBack}>&lt;- Back to discover</button>
      <div className="section-heading">
        <div><p className="eyebrow"><span></span> Your entries</p><h2 id="my-matches-title">MY MATCHES.</h2></div>
        <p>{active.length} upcoming · {past.length} finished</p>
      </div>

      {active.length === 0 && (
        <div className="my-matches-empty">
          <strong>No upcoming matches.</strong>
          <span>Join a match and it shows up here, with its countdown and the room ID once it is ready.</span>
          <button className="auth-submit" type="button" onClick={onBrowseMatches}>Browse matches <span>-&gt;</span></button>
        </div>
      )}

      {active.length > 0 && (
        <div className="my-match-list">
          {active.map(({ match, state }) => {
            const start = Number(match.matchTimestamp) || 0
            const canEdit = start && currentTime < start - EDIT_LOCK_MS
            const players = (match.identifiers?.length ? match.identifiers : [match.identifier]).filter(Boolean)
            return (
              <article className={`my-match-card is-${state.tone}`} key={match.id}>
                <header>
                  <div>
                    <p>{match.publicId || 'Match'} · Free Fire MAX</p>
                    <h3>{match.mode || 'Joined match'}</h3>
                  </div>
                  <span className={`my-match-badge is-${state.tone}`}>{state.label}</span>
                </header>
                <dl>
                  <div><dt>When</dt><dd>{formatWhen(start)}</dd></div>
                  {match.teamNo && <div><dt>Team no.</dt><dd>#{match.teamNo}</dd></div>}
                  {match.entryFee > 0 && <div><dt>Entry</dt><dd>{Number(match.entryFee).toLocaleString()} coins</dd></div>}
                  <div className="my-match-players"><dt>{players.length > 1 ? 'Your team' : 'Player'}</dt><dd>{players.join(', ') || 'Confirmed'}</dd></div>
                </dl>
                {match.roomId ? (
                  <div className="my-match-room">
                    <CopyValue label="Room ID" value={match.roomId} />
                    <CopyValue label="Password" value={match.roomPassword} />
                  </div>
                ) : (
                  <p className="my-match-note">{start && currentTime >= start ? 'The room details have not been posted yet. Keep this page open.' : 'The room ID and password appear here 10 minutes before the start.'}</p>
                )}
                <footer>
                  <button type="button" onClick={() => onOpenDetails(match)}>Match details</button>
                  {canEdit && <button type="button" onClick={() => onEditNames(match)}>Edit names</button>}
                </footer>
              </article>
            )
          })}
        </div>
      )}

      {past.length > 0 && (
        <div className="history-group my-match-past">
          <h3 className="history-group-title">FINISHED</h3>
          <div className="match-history-list">
            {past.map(({ match }) => (
              <article className="match-history-row" key={match.id}>
                <div className="match-game-mark">FF</div>
                <div><h3>{match.mode || 'Joined match'}</h3><p>{match.publicId || 'Match'}{match.teamNo ? ` · Team #${match.teamNo}` : ''} · {formatWhen(Number(match.matchTimestamp))}</p></div>
                <strong className={match.won ? 'victory' : 'defeat'}>{match.won ? 'WON' : 'PLAYED'}</strong>
                <span>{(match.identifiers?.length ? match.identifiers : [match.identifier]).filter(Boolean).join(', ')}</span>
              </article>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

export default MyMatchesSection
