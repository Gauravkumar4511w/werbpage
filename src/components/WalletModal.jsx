import { useEffect, useRef, useState } from 'react'

function WalletModal({ coins, creditCoins, winningCoins, withdrawableCoins, walletTab, setWalletTab, onClose, buyAmount, setBuyAmount, onUpiBuy, onCancelPayment, onOpenUpiPayment, manualUtr, setManualUtr, pendingPayment, onSubmitPaymentProof, paymentHistory = [], withdrawAmount, setWithdrawAmount, withdrawMethod, setWithdrawMethod, withdrawDetails, setWithdrawDetails, setWithdrawalScreenshot, requestWithdrawal, walletMessage }) {
  const updateDetails = (field, value) => setWithdrawDetails({ ...withdrawDetails, [field]: value })
  const paymentExpiresAt = pendingPayment?.expiresAt || (pendingPayment?.createdAt ? new Date(pendingPayment.createdAt).getTime() + 5 * 60 * 1000 : 0)
  const [screenshot, setScreenshot] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState(() => Math.max(0, Math.ceil((paymentExpiresAt - Date.now()) / 1000)))
  const modal = useRef(null)

  // A new QR replaces the amount picker, so bring the player to the top where it is.
  useEffect(() => {
    if (pendingPayment) modal.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }, [pendingPayment])

  useEffect(() => {
    if (!paymentExpiresAt) {
      return undefined
    }
    const updateTimer = () => setSecondsLeft(Math.max(0, Math.ceil((paymentExpiresAt - Date.now()) / 1000)))
    const timer = window.setInterval(updateTimer, 1000)
    return () => window.clearInterval(timer)
  }, [paymentExpiresAt])

  const submitProof = async (event) => {
    event.preventDefault()
    if (submitting || secondsLeft <= 0 || manualUtr.trim().length < 6 || !screenshot) return
    setSubmitting(true)
    const submitted = await onSubmitPaymentProof({ utr: manualUtr.trim(), screenshot })
    setSubmitting(false)
    if (submitted) setScreenshot(null)
  }

  return (
    <div className="wallet-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="wallet-modal" role="dialog" aria-modal="true" aria-labelledby="wallet-title" ref={modal}>
        <button className="auth-close" type="button" aria-label="Close wallet" onClick={onClose}>x</button>
        <div className="auth-kicker"><span></span> ARENACORE WALLET</div>
        <h2 id="wallet-title">COIN CENTER.</h2>
        <div className="wallet-balance"><span className="coin-icon" aria-hidden="true"></span><strong>{coins.toLocaleString()}</strong><small>AVAILABLE COINS</small></div>
        <div className="wallet-tabs">
          <button className={walletTab === 'buy' ? 'selected' : ''} type="button" onClick={() => setWalletTab('buy')}>Buy coins</button>
          <button className={walletTab === 'withdraw' ? 'selected' : ''} type="button" onClick={() => setWalletTab('withdraw')}>Withdraw</button>
        </div>
        {walletTab === 'buy' ? (
          <>
            {/* One step at a time: the QR and proof form while a payment is open, the amount picker otherwise. */}
            {pendingPayment ? (
              <div className="payment-step">
                <ol className="payment-steps" aria-label="How to pay">
                  <li className="is-current"><b>1</b> Scan &amp; pay</li>
                  <li><b>2</b> Upload proof</li>
                </ol>
                <div className="payment-qr-panel">
                  <div className="payment-countdown" aria-live="polite">
                    <span>PAY {pendingPayment.amount.toLocaleString()} COINS · ₹{pendingPayment.amount.toLocaleString()}</span>
                    <strong className={secondsLeft < 60 ? 'is-urgent' : ''}>{secondsLeft > 0 ? `${String(Math.floor(secondsLeft / 60)).padStart(2, '0')}:${String(secondsLeft % 60).padStart(2, '0')}` : 'EXPIRED'}</strong>
                  </div>
                  {pendingPayment.upiUrl && secondsLeft > 0 ? <img className="payment-qr" src={`https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(pendingPayment.upiUrl)}`} alt="UPI payment QR code" /> : <div className="payment-qr-expired">QR expired<br />Start a new payment</div>}
                  {pendingPayment.upiUrl && secondsLeft > 0 && <p className="payment-receiver">Paying to <strong>{new URL(pendingPayment.upiUrl).searchParams.get('pa')}</strong></p>}
                  {secondsLeft > 0 && <button className="payment-upi-button" type="button" onClick={onOpenUpiPayment}>Open UPI app <span>-&gt;</span></button>}
                </div>
                {secondsLeft > 0 && (
                  <form className="coin-custom-form" onSubmit={submitProof}>
                    <p>After paying, upload the payment screenshot and enter the UTR from your UPI app.</p>
                    <label>Payment screenshot<input type="file" accept="image/*" onChange={(event) => setScreenshot(event.target.files?.[0] || null)} required /></label>
                    <label>UTR / transaction ID<input value={manualUtr} onChange={(event) => setManualUtr(event.target.value)} placeholder="12-digit UTR" required /></label>
                    <button className="auth-submit" type="submit" disabled={submitting}>{submitting ? 'Submitting...' : <>Submit payment proof <span>-&gt;</span></>}</button>
                  </form>
                )}
                <button className="payment-cancel" type="button" onClick={() => { setScreenshot(null); onCancelPayment() }}>{secondsLeft > 0 ? 'Close QR · I don\'t want to pay now' : 'Choose a new amount'}</button>
              </div>
            ) : (
              <>
                <div className="coin-packages">{[[500, 'Starter'], [1200, 'Player'], [2500, 'Elite']].map(([amount, label]) => <button type="button" key={amount} onClick={() => onUpiBuy(amount)}><strong>{amount.toLocaleString()}</strong><span>{label} pack</span><small>Pay ₹{amount.toLocaleString()} by UPI</small></button>)}</div>
                <form className="coin-custom-form" onSubmit={(event) => { event.preventDefault(); onUpiBuy(Number(buyAmount)) }}>
                  <label>Or enter coins (1 coin = ₹1)<input type="number" min="50" step="1" value={buyAmount} onChange={(event) => setBuyAmount(event.target.value)} placeholder="Minimum 50" required /></label>
                  <button className="auth-submit" type="submit">Show payment QR <span>-&gt;</span></button>
                </form>
              </>
            )}
            {paymentHistory.length > 0 && (
              <div className="wallet-history">
                <h3>Your top-ups</h3>
                {paymentHistory.slice(0, 5).map((payment) => (
                  <div className="wallet-history-row" key={payment.id}>
                    <strong>{payment.coins.toLocaleString()} coins</strong>
                    <em className={`is-${payment.status}`}>{payment.status === 'pending' ? 'verifying' : payment.status}</em>
                    <small>UTR {payment.utr}</small>
                    {payment.status === 'rejected' && payment.review_note && <p>{payment.review_note}</p>}
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <form className="withdraw-form" onSubmit={requestWithdrawal}>
            <div className="withdraw-balances" aria-label="Coin balances">
              <div><span>Credit coins</span><strong>{creditCoins.toLocaleString()}</strong><small>Not withdrawable</small></div>
              <div><span>Winning coins</span><strong>{winningCoins.toLocaleString()}</strong><small>Withdrawable</small></div>
            </div>
            <div className="payment-methods"><button className={withdrawMethod === 'upi' ? 'selected' : ''} type="button" onClick={() => setWithdrawMethod('upi')}>UPI</button><button className={withdrawMethod === 'bank' ? 'selected' : ''} type="button" onClick={() => setWithdrawMethod('bank')}>Bank transfer</button></div>
            <label>Winning coins to withdraw<input type="number" min="50" max={withdrawableCoins} step="1" value={withdrawAmount} onChange={(event) => setWithdrawAmount(event.target.value)} placeholder="50 to winning balance" required /></label>
            {withdrawMethod === 'upi' ? <div className="bank-fields"><label>UPI ID<input value={withdrawDetails.upiId} onChange={(event) => updateDetails('upiId', event.target.value)} placeholder="player@upi" required /></label><label>Name on UPI account<input value={withdrawDetails.upiName} onChange={(event) => updateDetails('upiName', event.target.value)} placeholder="As shown in your UPI app" maxLength={60} autoComplete="name" required /></label></div> : <div className="bank-fields"><label>Account holder name<input value={withdrawDetails.accountName} onChange={(event) => updateDetails('accountName', event.target.value)} placeholder="Full name" required /></label><label>Account number<input inputMode="numeric" value={withdrawDetails.accountNumber} onChange={(event) => updateDetails('accountNumber', event.target.value.replace(/\D/g, ''))} placeholder="9-18 digits" required /></label><label>IFSC code<input value={withdrawDetails.ifsc} onChange={(event) => updateDetails('ifsc', event.target.value.toUpperCase())} placeholder="ABCD0123456" required /></label></div>}
            <label>UPI QR screenshot<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setWithdrawalScreenshot(event.target.files?.[0] || null)} required /></label>
            <p>Withdraw between 50 and {withdrawableCoins.toLocaleString()} winning coins. Purchased coins cannot be withdrawn.</p>
            <button className="auth-submit" type="submit">Request withdrawal <span>-&gt;</span></button>
          </form>
        )}
        {walletMessage && <p className="wallet-message" role="status">{walletMessage}</p>}
      </section>
    </div>
  )
}

export default WalletModal
