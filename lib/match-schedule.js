// Shared by the API and the browser so both build the same daily schedule with the same match ids.
// The schedule runs on India time, whatever time zone the server or the player's phone uses.

export const MATCH_MODES = ['Battle Royale Solo', 'Battle Royale Duo', 'Battle Royale Squad', 'Clash Squad 1v1', 'Clash Squad 2v2', 'Clash Squad 4v4', 'Lone Wolf 1v1']

export const DEFAULT_ENTRY_FEES = {
  'Battle Royale Solo': 50,
  'Battle Royale Duo': 100,
  'Battle Royale Squad': 150,
  'Clash Squad 1v1': 50,
  'Clash Squad 2v2': 100,
  'Clash Squad 4v4': 200,
  'Lone Wolf 1v1': 75,
}

const MATCH_CAPACITY = {
  'Battle Royale Solo': { total: 48, unit: 'players', teamSize: 1 },
  'Battle Royale Duo': { total: 24, unit: 'teams', teamSize: 2 },
  'Battle Royale Squad': { total: 12, unit: 'teams', teamSize: 4 },
  'Clash Squad 1v1': { total: 2, unit: 'players', teamSize: 1 },
  'Clash Squad 2v2': { total: 2, unit: 'teams', teamSize: 2 },
  'Clash Squad 4v4': { total: 2, unit: 'teams', teamSize: 4 },
  'Lone Wolf 1v1': { total: 2, unit: 'players', teamSize: 1 },
}

// Only today's matches are created; each day's matches are made when that day starts (India time).
export const SCHEDULE_DAYS = 1
export const EDIT_LOCK_MS = 60 * 60 * 1000
export const ROOM_REVEAL_MS = 10 * 60 * 1000
const IST_OFFSET_MS = 330 * 60 * 1000
const FIRST_MATCH_MINUTES = 8 * 60
const MINUTES_BETWEEN_MATCHES = 80

export function getMatchCapacity(mode) {
  return MATCH_CAPACITY[mode] || { total: 2, unit: 'players', teamSize: 1 }
}

// Each registration is one team, so a team needs one in-game name or UID per player.
export function getTeamSize(mode) {
  return getMatchCapacity(mode).teamSize
}

export function getScheduledMatches(now = Date.now(), days = SCHEDULE_DAYS) {
  const today = new Date(now + IST_OFFSET_MS)
  const matches = []
  for (let dayIndex = 0; dayIndex < days; dayIndex += 1) {
    // Midnight in India, as a UTC instant. Its ISO string starts the match id, as it always has.
    const midnight = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + dayIndex) - IST_OFFSET_MS
    const dayPrefix = new Date(midnight).toISOString()
    for (let round = 0; round < 2; round += 1) {
      MATCH_MODES.forEach((mode, modeIndex) => {
        const minutes = FIRST_MATCH_MINUTES + (round * MATCH_MODES.length + modeIndex) * MINUTES_BETWEEN_MATCHES
        matches.push({
          id: `${dayPrefix}-${minutes}-${mode}`,
          mode,
          entryFee: DEFAULT_ENTRY_FEES[mode],
          matchTimestamp: midnight + minutes * 60 * 1000,
        })
      })
    }
  }
  return matches
}

// Matches are numbered per day: #01, #02... in start order, at most two digits.
export const MAX_MATCHES_PER_DAY = 99
// The 12:00 AM and 1:20 AM matches still belong to the day before, like the rest of its schedule.
const DAY_ROLLOVER_MS = 2 * 60 * 60 * 1000

// The India date (YYYY-MM-DD) whose schedule a match belongs to.
export function getMatchDay(timestamp) {
  const value = Number(timestamp)
  if (!Number.isFinite(value) || value <= 0) return ''
  return new Date(value - DAY_ROLLOVER_MS + IST_OFFSET_MS).toISOString().slice(0, 10)
}

// Today's date in India (YYYY-MM-DD).
export function getIndiaDate(now = Date.now()) {
  return new Date(now + IST_OFFSET_MS).toISOString().slice(0, 10)
}

export function formatMatchNo(dayNo) {
  const number = Number(dayNo)
  return number ? `#${String(number).padStart(2, '0')}` : ''
}

// "#05 (4 Nov)": the daily number with its day, for messages that may be read on another day.
export function formatMatchLabel(match) {
  const number = formatMatchNo(match?.day_no ?? match?.dayNo)
  const day = match?.match_day ?? match?.matchDay
  if (!number) return match?.public_id ? `#${match.public_id}` : 'match'
  return day ? `${number} (${new Date(`${day}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })})` : number
}

// "#05", "05" or "5" means match 5 of a day. Every day has a match 5, so this picks the one that
// starts closest to now. Returns null for anything that is not a one or two digit number.
export function pickByMatchNo(matches, value, now = Date.now()) {
  const found = /^#?(\d{1,2})$/.exec(String(value ?? '').trim())
  if (!found) return null
  const number = Number(found[1])
  return matches
    .filter((match) => Number(match.day_no) === number)
    .sort((a, b) => Math.abs(Number(a.match_timestamp) - now) - Math.abs(Number(b.match_timestamp) - now))[0] || null
}
