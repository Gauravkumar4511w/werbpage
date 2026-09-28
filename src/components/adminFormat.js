// SQLite CURRENT_TIMESTAMP values are UTC without a zone ("2026-09-28 10:00:00"); other dates are epoch ms.
export function toDate(value) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number') return new Date(value)
  const text = String(value)
  const date = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(text) ? text : `${text.replace(' ', 'T')}Z`)
  return Number.isNaN(date.getTime()) ? null : date
}

export function formatDate(value) {
  const date = toDate(value)
  return date ? date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '-'
}

export function timeAgo(value) {
  const date = toDate(value)
  if (!date) return ''
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000))
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

export function withdrawalDestination(row) {
  let details = row.details
  if (typeof details === 'string') {
    try { details = JSON.parse(details) } catch { details = {} }
  }
  if (!details) return '-'
  if (row.method === 'upi') return details.upiId || '-'
  return [details.accountName, details.accountNumber, details.ifsc].filter(Boolean).join(' · ') || '-'
}

export const ledgerReasons = {
  topup_approved: 'Top-up approved',
  admin_add: 'Added by admin',
  admin_deduct: 'Deducted by admin',
  match_entry: 'Match entry',
  match_refund: 'Match refund',
  match_win: 'Match winnings',
  withdrawal_hold: 'Withdrawal requested',
  withdrawal_refund: 'Withdrawal refunded',
}
