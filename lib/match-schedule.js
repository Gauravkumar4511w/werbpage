// Shared by the API and the browser so both build the same daily schedule with the same match ids.
// The schedule runs on India time, whatever time zone the server or the player's phone uses.

export const MATCH_MODES = ['Battle Royale Solo', 'Battle Royale Duo', 'Battle Royale Squad', 'Clash Squad 1v1', 'Clash Squad 2v2', 'Clash Squad 4v4', 'Lone Wolf 1v1']

// Kept low (10-15 coins) so more players can afford to join: 10 for one-player modes, 15 for team modes.
// Battle Royale Duo is 25, its per kill tier below.
export const DEFAULT_ENTRY_FEES = {
  'Battle Royale Solo': 10,
  'Battle Royale Duo': 25,
  'Battle Royale Squad': 15,
  'Clash Squad 1v1': 10,
  'Clash Squad 2v2': 15,
  'Clash Squad 4v4': 15,
  'Lone Wolf 1v1': 10,
}

// The fees daily matches had before 18 Nov 2026, used once to lower the matches already made that day.
export const PREVIOUS_ENTRY_FEES = {
  'Battle Royale Solo': 50,
  'Battle Royale Duo': 100,
  'Battle Royale Squad': 150,
  'Clash Squad 1v1': 50,
  'Clash Squad 2v2': 100,
  'Clash Squad 4v4': 200,
  'Lone Wolf 1v1': 10,
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

// Launch offer, 21 Nov to 4 Dec 2026 (India dates): each mode's first daily match (8:00 AM to
// 4:00 PM) is free to join. Its prize stays what the paid match pays, so the house funds it.
export const FREE_MATCH_FIRST_DAY = '2026-11-21'
export const FREE_MATCH_LAST_DAY = '2026-12-04'

// What joining costs: nothing for a free match, otherwise its entry fee. The entry fee still sets
// the prize, so a free match keeps it.
export function getEntryCost({ entryFee, freeEntry }) {
  return freeEntry ? 0 : Number(entryFee) || 0
}
export const ROOM_REVEAL_MS = 10 * 60 * 1000
const IST_OFFSET_MS = 330 * 60 * 1000
const FIRST_MATCH_MINUTES = 8 * 60
const MINUTES_BETWEEN_MATCHES = 80

export function getMatchCapacity(mode) {
  return MATCH_CAPACITY[mode] || { total: 2, unit: 'players', teamSize: 1 }
}

// Without a prize set by the admin, the winning team gets this share of all entry fees paid.
export const WINNER_SHARE = 0.8

// Battle Royale pays coins for every kill, set by the entry fee as [fee, coins per kill], highest first.
// Solo: 10 → 4, 15 → 7, 25 → 10. Duo: 25 → 6, and the same share of the fee (6/25) for 10 → 2 and 15 → 4.
// Squad (one fee for the whole squad): 10 → 1, 15 → 2, 25 → 4, and the same share (4/25) rounded down
// for 30 → 4 and 35 → 5.
// Fees in between use the tier below (20 → 7 in Solo). Other modes pay no kill coins unless the admin
// sets a rate for that match.
const PER_KILL_TIERS = {
  'Battle Royale Solo': [[25, 10], [15, 7], [10, 4]],
  'Battle Royale Duo': [[25, 6], [15, 4], [10, 2]],
  'Battle Royale Squad': [[35, 5], [25, 4], [15, 2], [10, 1]],
}

export function getDefaultPerKill(mode, entryFee) {
  const fee = Number(entryFee) || 0
  return PER_KILL_TIERS[mode]?.find(([minFee]) => fee >= minFee)?.[1] ?? 0
}

// The coins one kill earns in a match: the admin's rate if set, otherwise the default above.
export function getPerKillCoins({ mode, entryFee, perKill }) {
  if (perKill !== null && perKill !== undefined && perKill !== '') return Number(perKill)
  return getDefaultPerKill(mode, entryFee)
}

// Battle Royale pays per kill instead, so only Clash Squad and Lone Wolf pay the winner by default.
export function paysWinnerByDefault(mode) {
  return !String(mode || '').startsWith('Battle Royale')
}

// The coins the winning team gets: the admin's prize if set, otherwise 80% of the entry fees when
// every slot is filled (fewer teams joining means a smaller payout), or 0 in Battle Royale.
export function getWinningCoins({ mode, entryFee, prizePool }) {
  if (prizePool !== null && prizePool !== undefined && prizePool !== '') return Number(prizePool)
  if (!paysWinnerByDefault(mode)) return 0
  return Math.floor((Number(entryFee) || 0) * getMatchCapacity(mode).total * WINNER_SHARE)
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
    const indiaDay = new Date(midnight + IST_OFFSET_MS).toISOString().slice(0, 10)
    for (let round = 0; round < 2; round += 1) {
      MATCH_MODES.forEach((mode, modeIndex) => {
        const minutes = FIRST_MATCH_MINUTES + (round * MATCH_MODES.length + modeIndex) * MINUTES_BETWEEN_MATCHES
        matches.push({
          id: `${dayPrefix}-${minutes}-${mode}`,
          mode,
          entryFee: DEFAULT_ENTRY_FEES[mode],
          freeEntry: round === 0 && indiaDay >= FREE_MATCH_FIRST_DAY && indiaDay <= FREE_MATCH_LAST_DAY,
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
