import { useState } from 'react'
import { formatDate, ledgerReasons, withdrawalDestination } from './adminFormat'

const sections = [
  ['wallet', 'Wallet history'],
  ['topups', 'Top-ups'],
  ['withdrawals', 'Withdrawals'],
  ['matches', 'Matches'],
]

function AdminUserDetail({ detail, busy, onAdjust, onSetStatus, onRefresh, onClose, onReviewPayment, onReviewWithdrawal }) {
  const { user, totals, transactions, payments, withdrawals, entries } = detail
  const [form, setForm] = useState({ wallet: 'credit', amount: '', note: '' })
  const [formError, setFormError] = useState('')
  const [section, setSection] = useState('wallet')
  const counts = { wallet: transactions.length, topups: payments.length, withdrawals: withdrawals.length, matches: entries.length }

  const submitAdjustment = async (direction) => {
    const amount = Number(form.amount)
    if (!Number.isInteger(amount) || amount <= 0) {
      setFormError('Enter a whole number of coins greater than 0.')
      return
    }
    const balance = form.wallet === 'credit' ? user.credit_coins : user.winning_coins
    if (direction === 'deduct' && amount > balance) {
      setFormError(`Only ${balance.toLocaleString()} ${form.wallet} coins are available to deduct.`)
      return
    }
    const verb = direction === 'deduct' ? 'Deduct' : 'Add'
    if (!window.confirm(`${verb} ${amount.toLocaleString()} ${form.wallet} coins ${direction === 'deduct' ? 'from' : 'to'} ${user.user_key}?`)) return
    setFormError('')
    const saved = await onAdjust({ wallet: form.wallet, amount: direction === 'deduct' ? -amount : amount, note: form.note.trim() })
    if (saved) setForm({ ...form, amount: '', note: '' })
  }

  return (
    <section className="admin-user-detail" aria-label={`User ${user.user_key}`}>
      <div className="admin-card-heading">
        <div>
          <h2>{user.display_name || user.user_key}</h2>
          <span>
            <code>{user.user_key}</code>
            <span className={`admin-status is-${user.status}`}>{user.status}</span>
            <span className={`admin-status ${user.is_online ? 'is-online' : 'is-offline'}`}>{user.is_online ? 'online' : 'offline'}</span>
          </span>
        </div>
        <div className="admin-inline-actions">
          <button type="button" onClick={onRefresh} disabled={busy}>Refresh</button>
          <button type="button" onClick={() => onSetStatus(user.status === 'inactive' ? 'active' : 'inactive')} disabled={busy}>
            {user.status === 'inactive' ? 'Activate user' : 'Deactivate user'}
          </button>
          <button type="button" onClick={onClose}>Close</button>
        </div>
      </div>

      <dl className="admin-user-facts">
        <div><dt>Email</dt><dd>{user.email || '-'}</dd></div>
        <div><dt>Phone</dt><dd>{user.phone || '-'}</dd></div>
        <div><dt>Joined</dt><dd>{formatDate(user.created_at)}</dd></div>
        <div><dt>Last active</dt><dd>{user.last_active_at ? formatDate(Number(user.last_active_at)) : '-'}</dd></div>
      </dl>

      <div className="admin-user-columns">
        <div>
          <div className="admin-balance-grid">
            <div><span>Credit coins</span><strong>{user.credit_coins.toLocaleString()}</strong><small>Top-ups · not withdrawable</small></div>
            <div><span>Winning coins</span><strong>{user.winning_coins.toLocaleString()}</strong><small>Withdrawable</small></div>
            <div><span>Total balance</span><strong>{totals.totalCoins.toLocaleString()}</strong><small>What the player sees</small></div>
          </div>
          <div className="admin-balance-grid is-muted">
            <div><span>Approved top-ups</span><strong>{totals.approvedTopups.toLocaleString()}</strong></div>
            <div><span>Pending top-ups</span><strong>{totals.pendingTopups.toLocaleString()}</strong></div>
            <div><span>Total winnings</span><strong>{totals.totalWinnings.toLocaleString()}</strong></div>
            <div><span>Withdrawn</span><strong>{totals.withdrawn.toLocaleString()}</strong><small>{totals.pendingWithdrawals.toLocaleString()} pending</small></div>
          </div>
        </div>

        <form className="admin-adjust-form" onSubmit={(event) => { event.preventDefault(); submitAdjustment('add') }}>
          <h3>Add or deduct balance</h3>
          <div className="admin-wallet-toggle" role="radiogroup" aria-label="Wallet">
            {['credit', 'winning'].map((wallet) => (
              <button key={wallet} type="button" role="radio" aria-checked={form.wallet === wallet} className={form.wallet === wallet ? 'selected' : ''} onClick={() => setForm({ ...form, wallet })}>
                {wallet} coins
              </button>
            ))}
          </div>
          <label>Coins
            <input type="number" min="1" step="1" inputMode="numeric" value={form.amount} onChange={(event) => { setForm({ ...form, amount: event.target.value }); setFormError('') }} placeholder="e.g. 100" required />
          </label>
          <label>Reason (saved in wallet history)
            <input value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} placeholder="Bonus, refund, correction..." maxLength={140} />
          </label>
          {formError && <p className="admin-form-error">{formError}</p>}
          <div className="admin-adjust-buttons">
            <button type="submit" className="is-add" disabled={busy}>+ Add coins</button>
            <button type="button" className="is-deduct" disabled={busy} onClick={() => submitAdjustment('deduct')}>− Deduct coins</button>
          </div>
        </form>
      </div>

      <nav className="admin-subtabs">
        {sections.map(([key, label]) => (
          <button key={key} type="button" className={section === key ? 'selected' : ''} onClick={() => setSection(key)}>{label} ({counts[key]})</button>
        ))}
      </nav>

      <div className="admin-table-wrap">
        {section === 'wallet' && (
          <table>
            <thead><tr><th>When</th><th>Change</th><th>Wallet</th><th>Balance after</th><th>Reason</th><th>Note</th></tr></thead>
            <tbody>
              {transactions.length ? transactions.map((row) => (
                <tr key={row.id}>
                  <td>{formatDate(row.created_at)}</td>
                  <td className={row.amount > 0 ? 'admin-amount-plus' : 'admin-amount-minus'}>{row.amount > 0 ? '+' : ''}{row.amount.toLocaleString()}</td>
                  <td>{row.wallet}</td>
                  <td>{row.balance_after.toLocaleString()}</td>
                  <td>{ledgerReasons[row.reason] || row.reason}</td>
                  <td>{row.note || '-'}</td>
                </tr>
              )) : <tr><td colSpan="6">No balance changes yet.</td></tr>}
            </tbody>
          </table>
        )}
        {section === 'topups' && (
          <table>
            <thead><tr><th>ID</th><th>Coins</th><th>UTR</th><th>Status</th><th>Submitted</th><th>Action</th></tr></thead>
            <tbody>
              {payments.length ? payments.map((row) => (
                <tr key={row.id}>
                  <td>#{row.id}</td>
                  <td>{row.coins.toLocaleString()}</td>
                  <td><code>{row.utr || '-'}</code></td>
                  <td><span className={`admin-status is-${row.status}`} title={row.review_note || undefined}>{row.status}</span></td>
                  <td>{formatDate(row.created_at)}</td>
                  <td>{row.status === 'pending' ? <ReviewButtons busy={busy} onApprove={() => onReviewPayment({ ...row, user_key: user.user_key }, 'approve')} onReject={() => onReviewPayment({ ...row, user_key: user.user_key }, 'reject')} /> : formatDate(row.reviewed_at)}</td>
                </tr>
              )) : <tr><td colSpan="6">No top-up requests.</td></tr>}
            </tbody>
          </table>
        )}
        {section === 'withdrawals' && (
          <table>
            <thead><tr><th>ID</th><th>Coins</th><th>Method</th><th>Pay to</th><th>Status</th><th>Requested</th><th>Action</th></tr></thead>
            <tbody>
              {withdrawals.length ? withdrawals.map((row) => (
                <tr key={row.id}>
                  <td>#{row.id}</td>
                  <td>{row.amount.toLocaleString()}</td>
                  <td>{row.method.toUpperCase()}</td>
                  <td>{withdrawalDestination(row)}</td>
                  <td><span className={`admin-status is-${row.status}`} title={row.review_note || undefined}>{row.status}</span></td>
                  <td>{formatDate(row.created_at)}</td>
                  <td>{row.status === 'pending' ? <ReviewButtons busy={busy} approveLabel="Mark paid" onApprove={() => onReviewWithdrawal({ ...row, user_key: user.user_key }, 'approve')} onReject={() => onReviewWithdrawal({ ...row, user_key: user.user_key }, 'reject')} /> : formatDate(row.reviewed_at)}</td>
                </tr>
              )) : <tr><td colSpan="7">No withdrawal requests.</td></tr>}
            </tbody>
          </table>
        )}
        {section === 'matches' && (
          <table>
            <thead><tr><th>Match</th><th>Mode</th><th>Entry fee</th><th>Starts</th><th>Status</th></tr></thead>
            <tbody>
              {entries.length ? entries.map((row) => (
                <tr key={row.match_id}>
                  <td>{row.public_id ? `#${row.public_id}` : row.match_id}</td>
                  <td>{row.mode || '-'}</td>
                  <td>{row.entry_fee ?? '-'}</td>
                  <td>{row.match_timestamp ? formatDate(Number(row.match_timestamp)) : '-'}</td>
                  <td>{row.status === 'confirmed' ? (row.winner_team_key === row.team_key ? 'Won' : 'Lost') : row.status || '-'}</td>
                </tr>
              )) : <tr><td colSpan="5">Has not joined any match.</td></tr>}
            </tbody>
          </table>
        )}
      </div>
    </section>
  )
}

export function ReviewButtons({ busy, onApprove, onReject, approveLabel = 'Approve' }) {
  return (
    <span className="admin-review-buttons">
      <button type="button" className="is-approve" disabled={busy} onClick={onApprove}>{approveLabel}</button>
      <button type="button" className="is-reject" disabled={busy} onClick={onReject}>Reject</button>
    </span>
  )
}

export default AdminUserDetail
