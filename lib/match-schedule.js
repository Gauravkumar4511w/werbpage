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

// Launch offer, 20 Nov to 4 Dec 2026 (India dates): each Battle Royale mode's first daily match is
// free to join (from 22 Nov: Solo 9:00 AM, Duo 6:00 PM, Squad 9:00 PM). Its prize stays what the
// paid match pays, so the house funds it. Clash Squad and Lone Wolf stay paid.
export const FREE_MATCH_FIRST_DAY = '2026-11-20'
export const FREE_MATCH_LAST_DAY = '2026-12-04'

// What joining costs: nothing for a free match, otherwise its entry fee. The entry fee still sets
// the prize, so a free match keeps it.
export function getEntryCost({ entryFee, freeEntry }) {
  return freeEntry ? 0 : Number(entryFee) || 0
}
export const ROOM_REVEAL_MS = 10 * 60 * 1000
const IST_OFFSET_MS = 330 * 60 * 1000
// Until 20 Nov 2026: every mode once from 8:00 AM, then again, a match every 80 minutes until
// 1:20 AM, so a mode's two matches were over nine hours apart.
const FIRST_MATCH_MINUTES = 8 * 60
const MINUTES_BETWEEN_MATCHES = 80

// Hourly timetables: one match every hour from 9:00 AM, each mode's matches back to back, an hour
// apart, so players of a mode find them together, and the team modes in the evening, when most
// players are free. Each entry is [mode, matches that day].
//
// 21 Nov 2026: two of each, 9:00 AM to 10:00 PM. The day switched at midday (see
// removeReplacedScheduledMatches in payout-db.js), which left Battle Royale Solo with only its
// 8:00 AM match, so two Solo matches were added that evening at 6:30 PM and 8:30 PM. The 6:30 PM
// one is free, so Solo had two free matches that day like Duo and Squad.
export const HOURLY_SCHEDULE_FROM = '2026-11-21'
const TWO_EACH = [['Battle Royale Solo', 2], ['Clash Squad 1v1', 2], ['Lone Wolf 1v1', 2], ['Clash Squad 2v2', 2], ['Battle Royale Duo', 2], ['Battle Royale Squad', 2], ['Clash Squad 4v4', 2]]
const EXTRA_SLOTS = {
  '2026-11-21': [{ mode: 'Battle Royale Solo', round: 2, minutes: 18 * 60 + 30, free: true }, { mode: 'Battle Royale Solo', round: 3, minutes: 20 * 60 + 30 }],
}
// From 22 Nov 2026: every Battle Royale mode three times, 17 matches from 9:00 AM to 1:00 AM.
export const THREE_BATTLE_ROYALE_FROM = '2026-11-22'
const THREE_BATTLE_ROYALE = [['Battle Royale Solo', 3], ['Clash Squad 1v1', 2], ['Lone Wolf 1v1', 2], ['Clash Squad 2v2', 2], ['Battle Royale Duo', 3], ['Battle Royale Squad', 3], ['Clash Squad 4v4', 2]]
const HOURLY_FIRST_MATCH_MINUTES = 9 * 60

function hourlySlots(layout) {
  let hour = 0
  return layout.flatMap(([mode, count]) => Array.from({ length: count }, (_, round) => ({ mode, round, minutes: HOURLY_FIRST_MATCH_MINUTES + (hour++) * 60 })))
}

// The day's matches as { mode, round, minutes after midnight }; round 0 is a mode's first match.
function getDailySlots(indiaDay) {
  if (indiaDay >= THREE_BATTLE_ROYALE_FROM) return hourlySlots(THREE_BATTLE_ROYALE)
  if (indiaDay >= HOURLY_SCHEDULE_FROM) {
    return [...hourlySlots(TWO_EACH), ...(EXTRA_SLOTS[indiaDay] || [])].sort((a, b) => a.minutes - b.minutes)
  }
  return [0, 1].flatMap((round) => MATCH_MODES.map((mode, modeIndex) => ({ mode, round, minutes: FIRST_MATCH_MINUTES + (round * MATCH_MODES.length + modeIndex) * MINUTES_BETWEEN_MATCHES })))
}

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
    for (const { mode, round, minutes, free } of getDailySlots(indiaDay)) {
      matches.push({
        id: `${dayPrefix}-${minutes}-${mode}`,
        mode,
        entryFee: DEFAULT_ENTRY_FEES[mode],
        freeEntry: (round === 0 || Boolean(free)) && mode.startsWith('Battle Royale') && indiaDay >= FREE_MATCH_FIRST_DAY && indiaDay <= FREE_MATCH_LAST_DAY,
        matchTimestamp: midnight + minutes * 60 * 1000,
      })
    }
  }
  return matches
}

// Matches are numbered per day: #01, #02... in start order, at most two digits.
export const MAX_MATCHES_PER_DAY = 99
// Matches just after midnight (12:00 AM and 1:20 AM until 20 Nov) still belong to the day before.
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
