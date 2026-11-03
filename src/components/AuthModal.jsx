import { useEffect, useState } from 'react'

function AuthModal({ authOpen, setAuthOpen, authMode, setAuthMode, showPassword, setShowPassword, authError, setAuthError, form, setForm, handleAuthSubmit, authBusy, signupOtp, onResendOtp, onResetOtp, player, profileStats, handleSignOut, onUpdateProfile }) {
  const emptyProfileForm = { name: null, email: null, phone: null }
  const [profileForm, setProfileForm] = useState(emptyProfileForm)
  const [profileError, setProfileError] = useState('')
  const [profileSaving, setProfileSaving] = useState(false)
  const [now, setNow] = useState(0)

  // Ticks once a second while a sign-up code is out, for the resend countdown.
  useEffect(() => {
    if (!signupOtp) return undefined
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [signupOtp])
  const resendWait = signupOtp ? Math.max(0, Math.ceil((signupOtp.resendAt - Math.max(now, signupOtp.sentAt)) / 1000)) : 0

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

  const handleGoogleSignup = () => {
    setAuthError('Google signup demo selected. Connect Google OAuth to enable real accounts.')
  }

  return (
    <div className="auth-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setAuthOpen(false)}>
      <section className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title">
        <button className="auth-close" type="button" aria-label="Close sign in" onClick={() => setAuthOpen(false)}>x</button>
        <div className="auth-kicker"><span></span> ARENACORE ACCOUNT</div>
        <h2 id="auth-title">{authMode === 'login' ? 'WELCOME BACK.' : 'JOIN THE SQUAD.'}</h2>
        <p className="auth-subtitle">{authMode === 'login' ? 'Log in to pick up where you left off.' : 'Create your account with mobile or Google.'}</p>
        {authMode === 'signup' && <button className="google-button" type="button" onClick={handleGoogleSignup}><strong>G</strong> Continue with Google</button>}
        {authMode === 'signup' && <div className="auth-divider"><span>OR SIGN UP WITH</span></div>}
        <form onSubmit={handleAuthSubmit}>
          {authMode === 'login' && <div className="signup-methods" role="group" aria-label="Choose login method"><button className={form.loginMethod === 'email' ? 'selected' : ''} type="button" onClick={() => { setForm({ ...form, loginMethod: 'email' }); setAuthError('') }}>Gmail / Email</button><button className={form.loginMethod === 'phone' ? 'selected' : ''} type="button" onClick={() => { setForm({ ...form, loginMethod: 'phone' }); setAuthError('') }}>Mobile number</button></div>}
          {authMode === 'signup' && (
            <>
              <div className="signup-methods" role="group" aria-label="Choose signup method"><button className={form.signupMethod === 'phone' ? 'selected' : ''} type="button" onClick={() => { setForm({ ...form, signupMethod: 'phone', otp: '' }); onResetOtp(); setAuthError('') }}>Mobile number</button><button className={form.signupMethod === 'email' ? 'selected' : ''} type="button" onClick={() => { setForm({ ...form, signupMethod: 'email', otp: '' }); onResetOtp(); setAuthError('') }}>Gmail / Email</button></div>
              {form.signupMethod === 'phone' ? <label>Mobile number<input type="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="+91 98765 43210" autoComplete="tel" readOnly={Boolean(signupOtp)} required /></label> : <label>Gmail / Email address<input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="you@gmail.com" autoComplete="email" readOnly={Boolean(signupOtp)} required /></label>}
              <label>Gamer tag<input value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} placeholder="e.g. ShadowKite" autoComplete="username" maxLength={24} required /></label>
              <label>Password<div className="password-field"><input type={showPassword ? 'text' : 'password'} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder="6+ characters" autoComplete="new-password" required /><button type="button" onClick={() => setShowPassword((visible) => !visible)}>{showPassword ? 'Hide' : 'Show'}</button></div></label>
              {signupOtp && (
                <div className="otp-panel">
                  <p className="otp-sent">Code sent to <strong>{signupOtp.sentTo}</strong> <button type="button" onClick={() => { onResetOtp(); setAuthError('') }}>Change</button></p>
                  {signupOtp.devOtp && <p className="otp-dev">Test mode, no SMS/email service set up. Your code: <strong>{signupOtp.devOtp}</strong></p>}
                  <label>Enter OTP<input className="otp-input" type="text" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={form.otp} onChange={(event) => setForm({ ...form, otp: event.target.value.replace(/\D/g, '').slice(0, 6) })} placeholder="------" autoComplete="one-time-code" autoFocus required /></label>
                  <button className="otp-resend" type="button" disabled={authBusy || resendWait > 0} onClick={onResendOtp}>{resendWait > 0 ? `Resend code in ${resendWait}s` : 'Resend code'}</button>
                </div>
              )}
              <button className="auth-submit" type="submit" disabled={authBusy}>{authBusy ? (signupOtp ? 'Verifying...' : 'Sending code...') : signupOtp ? <>Verify &amp; create account <span>-&gt;</span></> : <>Send OTP <span>-&gt;</span></>}</button>
            </>
          )}
          {authMode === 'login' && <><label>{form.loginMethod === 'email' ? 'Gmail / Email address' : 'Mobile number'}<input type={form.loginMethod === 'email' ? 'email' : 'tel'} value={form.loginMethod === 'email' ? form.email : form.phone} onChange={(event) => setForm({ ...form, [form.loginMethod]: event.target.value })} placeholder={form.loginMethod === 'email' ? 'you@gmail.com' : '+91 98765 43210'} autoComplete={form.loginMethod === 'email' ? 'email' : 'tel'} required /></label><label>Password<div className="password-field"><input type={showPassword ? 'text' : 'password'} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder="6+ characters" autoComplete="current-password" required /><button type="button" onClick={() => setShowPassword((visible) => !visible)}>{showPassword ? 'Hide' : 'Show'}</button></div></label><button className="auth-submit" type="submit">Log in <span>-&gt;</span></button></>}
          {authError && <p className="auth-error" role="alert">{authError}</p>}
        </form>
        <p className="auth-switch">{authMode === 'login' ? 'New to ArenaCore?' : 'Already have an account?'} <button type="button" onClick={() => { setAuthMode(authMode === 'login' ? 'signup' : 'login'); onResetOtp(); setAuthError('') }}>{authMode === 'login' ? 'Sign up' : 'Log in'}</button></p>
        {player && <button className="sign-out" type="button" onClick={handleSignOut}>Sign out of {player.name}</button>}
      </section>
    </div>
  )
}

export default AuthModal
