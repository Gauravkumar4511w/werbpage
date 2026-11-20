// Each mode family gets its own card look: Battle Royale burns orange, Clash Squad runs electric blue,
// Lone Wolf glows violet. The family also picks the second tag shown on its cards.
export function getModeFamily(mode = '') {
  if (mode.startsWith('Battle Royale')) return { key: 'br', tag: 'Bermuda' }
  if (mode.startsWith('Clash Squad')) return { key: 'cs', tag: 'Clash Squad' }
  if (mode.startsWith('Lone Wolf')) return { key: 'lw', tag: 'Lone Wolf' }
  return { key: 'br', tag: 'Free Fire' }
}

export function getModeFormat(mode = '') {
  if (mode.includes('1v1')) return '1v1'
  if (mode.includes('2v2')) return 'Duo'
  if (mode.includes('4v4')) return 'Squad'
  return mode.match(/(Solo|Duo|Squad|\d+v\d+)/i)?.[1] || mode
}

// "in 2h 15m" until the start, for the line under a card's time.
export function formatStartsIn(ms) {
  const minutes = Math.max(1, Math.ceil(ms / 60000))
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours >= 24) return `in ${Math.floor(hours / 24)}d ${hours % 24}h`
  if (hours) return `in ${hours}h ${rest}m`
  return `in ${rest} min`
}
