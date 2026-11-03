import { useEffect, useState } from 'react'
import GoogleButton from './GoogleButton'

const copy = {
  login: { title: 'WELCOME BACK.', subtitle: 'Log in to pick up where you left off.' },
  signup: { title: 'JOIN THE SQUAD.', subtitle: 'Create your account with Google or your email.' },
  forgot: { title: 'RESET PASSWORD.', subtitle: 'We will email you a code to set a new password.' },
}

function PasswordField({ label, value, onChange, showPassword, setShowPassword, autoComplete }) {
  return <label>{label}<div className="password-field"><input type={showPassword ? 'text' : 'password'} value={value} onChange={onChange} placeholder="6+ characters" autoComplete={autoComplete} required /><button type="button" onClick={() => setShowPassword((visible) => !visible)}>{showPassword ? 'Hide' : 'Show'}</button></div></label>
}

function AuthModal({ authOpen, setAuthOpen, authMode, setAuthMode, showPassword, setShowPassword, authError, setAuthError, form, setForm, handleAuthSubmit, authBusy, otpChallenge, onResendOtp, onResetOtp, onGoogleCredential, player, profileStats, handleSignOut, onUpdateProfile }) {
  const emptyProfileForm = { name: null, email: null, phone: null }
  const [profileForm, setProfileForm] = useState(emptyProfileForm)
  const [profileError, setProfileError] = useState('')
  const [profileSaving, setProfileSaving] = useState(false)
  const [now, setNow] = useState(0)

  // Ticks once a second while a code is out, for the resend countdown.
  useEffect(() => {
    if (!otpChallenge) return undefined
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [otpChallenge])
  const resendWait = otpChallenge ? Math.max(0, Math.ceil((otpChallenge.resendAt - Math.max(now, otpChallenge.sentAt)) / 1000)) : 0

  if (!authOpen) return null

  if (player) {
    // Untouched fields are null, so fall back to the saved value for each one.
    const handleProfileSubmit = async (event) => {
      event.preventDefault()
      if (profileSaving) return
      setProfileSaving(true)
      const error = await onUpdateProfile({
        name: profileForm.name ?? player.name,
        email: profileForm.email ?? player.email ?? '',
        phone: profileForm.phone ?? player.phone ?? '',
      })
      setProfileSaving(false)
      setProfileError(error)
      if (!error) {
        setProfileForm(emptyProfileForm)
        setAuthOpen(false)
      }
    }

    return (
      <div className="auth-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setAuthOpen(false)}>
        <section className="auth-modal profile-modal" role="dialog" aria-modal="true" aria-labelledby="profile-title">
          <button className="auth-close" type="button" aria-label="Close profile" onClick={() => setAuthOpen(false)}>x</button>
          <div className="auth-kicker"><span></span> PLAYER PROFILE</div>
          <div className="profile-hero"><span className="profile-avatar-large">{player.name.slice(0, 2).toUpperCase()}<i></i></span><div><p className="profile-handle">@{player.name.toLowerCase().replace(/\s+/g, '')}</p><h2 id="profile-title">{player.name}</h2><p>LVL {String(profileStats.level).padStart(2, '0')} <span className="profile-divider">/</span> ARENACORE MEMBER</p></div><span className="profile-status"><i></i> ONLINE</span></div>
          <div className="profile-stats"><div><strong>{String(profileStats.level).padStart(2, '0')}</strong><span>LEVEL</span></div><div><strong>{profileStats.wins}</strong><span>WINS</span></div><div><strong>{profileStats.tournaments}</strong><span>TOURNAMENTS</span></div></div>
          <div className="profile-contact"><span className="profile-section-label">ACCOUNT DETAILS</span><div><span>EMAIL</span><strong>{player.email || 'Mobile account'}</strong></div><div><span>MOBILE</span><strong>{player.phone || 'Not added'}</strong></div></div>
          <div className="profile-edit-heading"><span className="profile-section-label">EDIT PROFILE</span><small>Keep your player details current.</small></div>
          <form className="profile-form" onSubmit={handleProfileSubmit}>
            <label>Gamer tag<input value={profileForm.name ?? player.name} onChange={(event) => setProfileForm({ ...profileForm, name: event.target.value })} maxLength={24} autoComplete="username" /></label>
            <label>Gmail / Email address<input type="email" value={profileForm.email ?? player.email ?? ''} onChange={(event) => setProfileForm({ ...profileForm, email: event.target.value })} placeholder="you@gmail.com" autoComplete="email" /></label>
            <label>Mobile number<input type="tel" value={profileForm.phone ?? player.phone ?? ''} onChange={(event) => setProfileForm({ ...profileForm, phone: event.target.value })} placeholder="+91 98765 43210" autoComplete="tel" /></label>
            <small className="profile-form-hint">Keep at least one: you log in with your email or mobile number.</small>
            {profileError && <p className="auth-error" role="alert">{profileError}</p>}
            <button className="auth-submit" type="submit" disabled={profileSaving}>{profileSaving ? 'Saving...' : <>Save profile <span>-&gt;</span></>}</button>
          </form>
          <button className="sign-out" type="button" onClick={() => { setProfileForm(emptyProfileForm); setProfileError(''); handleSignOut() }}>Sign out of {player.name}</button>
        </section>
      </div>
    )
  }

  const switchMode = (mode) => {
    setAuthMode(mode)
    onResetOtp()
    setAuthError('')
    setForm({ ...form, password: '', otp: '' })
  }
  const setField = (field) => (event) => setForm({ ...form, [field]: event.target.value })
  const codeSent = Boolean(otpChallenge)
  const submitLabel = {
    login: 'Log in',
    signup: codeSent ? 'Verify & create account' : 'Send OTP',
    forgot: codeSent ? 'Reset password & log in' : 'Send code',
  }[authMode]

  return (
    <div className="auth-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setAuthOpen(false)}>
      <section className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title">
        <button className="auth-close" type="button" aria-label="Close sign in" onClick={() => setAuthOpen(false)}>x</button>
        <div className="auth-kicker"><span></span> ARENACORE ACCOUNT</div>
        <h2 id="auth-title">{copy[authMode].title}</h2>
        <p className="auth-subtitle">{copy[authMode].subtitle}</p>
        {authMode !== 'forgot' && <GoogleButton onCredential={onGoogleCredential} onError={setAuthError} />}
        <form onSubmit={handleAuthSubmit}>
          {authMode === 'login' && (
            <>
              <div className="signup-methods" role="group" aria-label="Choose login method"><button className={form.loginMethod === 'email' ? 'selected' : ''} type="button" onClick={() => { setForm({ ...form, loginMethod: 'email' }); setAuthError('') }}>Gmail / Email</button><button className={form.loginMethod === 'phone' ? 'selected' : ''} type="button" onClick={() => { setForm({ ...form, loginMethod: 'phone' }); setAuthError('') }}>Mobile number</button></div>
              {form.loginMethod === 'email'
                ? <label>Gmail / Email address<input type="email" value={form.email} onChange={setField('email')} placeholder="you@gmail.com" autoComplete="email" required /></label>
                : <label>Mobile number<input type="tel" value={form.phone} onChange={setField('phone')} placeholder="+91 98765 43210" autoComplete="tel" required /></label>}
              <PasswordField label="Password" value={form.password} onChange={setField('password')} showPassword={showPassword} setShowPassword={setShowPassword} autoComplete="current-password" />
              <button className="forgot-link" type="button" onClick={() => switchMode('forgot')}>Forgot password?</button>
            </>
          )}
          {authMode !== 'login' && (
            <label>Gmail / Email address<input type="email" value={form.email} onChange={setField('email')} placeholder="you@gmail.com" autoComplete="email" readOnly={codeSent} required /></label>
          )}
          {authMode === 'signup' && (
            <>
              <label>Gamer tag<input value={form.username} onChange={setField('username')} placeholder="e.g. ShadowKite" autoComplete="username" maxLength={24} required /></label>
              <PasswordField label="Password" value={form.password} onChange={setField('password')} showPassword={showPassword} setShowPassword={setShowPassword} autoComplete="new-password" />
            </>
          )}
          {codeSent && (
            <div className="otp-panel">
              <p className="otp-sent">Code sent to <strong>{otpChallenge.sentTo}</strong> <button type="button" onClick={() => { onResetOtp(); setAuthError('') }}>Change</button></p>
              {otpChallenge.devOtp && <p className="otp-dev">Test mode, no email service set up. Your code: <strong>{otpChallenge.devOtp}</strong></p>}
              <label>Enter OTP<input className="otp-input" type="text" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={form.otp} onChange={(event) => setForm({ ...form, otp: event.target.value.replace(/\D/g, '').slice(0, 6) })} placeholder="------" autoComplete="one-time-code" autoFocus required /></label>
              <button className="otp-resend" type="button" disabled={authBusy || resendWait > 0} onClick={onResendOtp}>{resendWait > 0 ? `Resend code in ${resendWait}s` : 'Resend code'}</button>
            </div>
          )}
          {authMode === 'forgot' && codeSent && (
            <PasswordField label="New password" value={form.password} onChange={setField('password')} showPassword={showPassword} setShowPassword={setShowPassword} autoComplete="new-password" />
          )}
          <button className="auth-submit" type="submit" disabled={authBusy}>{authBusy ? 'Please wait...' : <>{submitLabel} <span>-&gt;</span></>}</button>
          {authError && <p className="auth-error" role="alert">{authError}</p>}
        </form>
        {authMode === 'forgot'
          ? <p className="auth-switch">Remembered it? <button type="button" onClick={() => switchMode('login')}>Back to log in</button></p>
          : <p className="auth-switch">{authMode === 'login' ? 'New to ArenaCore?' : 'Already have an account?'} <button type="button" onClick={() => switchMode(authMode === 'login' ? 'signup' : 'login')}>{authMode === 'login' ? 'Sign up' : 'Log in'}</button></p>}
      </section>
    </div>
  )
}

export default AuthModal
