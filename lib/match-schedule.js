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

export const SCHEDULE_DAYS = 5
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
