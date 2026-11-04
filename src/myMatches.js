import { ROOM_REVEAL_MS } from '../lib/match-schedule.js'

// A started match counts as in progress for this long, unless the admin has already posted the result.
const LIVE_WINDOW_MS = 3 * 60 * 60 * 1000

const timeFormat = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })

export function formatWhen(timestamp) {
  return timestamp ? timeFormat.format(new Date(timestamp)) : 'Time to be announced'
}

function formatCountdown(ms) {
  const minutes = Math.max(1, Math.ceil(ms / 60000))
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const rest = minutes % 60
  if (days) return `${days}d ${hours}h`
  if (hours) return `${hours}h ${rest}m`
  return `${rest} min`
}

// Where a joined match stands right now, for its badge and its place on the page.
export function matchState(match, now) {
  const start = Number(match.matchTimestamp) || 0
  if (match.status === 'confirmed' || (start && now >= start + LIVE_WINDOW_MS)) return { group: 'past', label: 'Finished', tone: 'muted' }
  if (start && now >= start) return { group: 'active', label: 'Live now', tone: 'live' }
  if (match.roomId) return { group: 'active', label: 'Room ready', tone: 'ready' }
  if (!start) return { group: 'active', label: 'Joined', tone: 'info' }
  const left = start - now
  return { group: 'active', label: `Starts in ${formatCountdown(left)}`, tone: left <= ROOM_REVEAL_MS ? 'soon' : 'info' }
}

// The navbar badge: joined matches that have not finished yet.
export function countUpcomingMatches(joinedMatches, now) {
  return joinedMatches.filter((match) => matchState(match, now).group === 'active').length
}
