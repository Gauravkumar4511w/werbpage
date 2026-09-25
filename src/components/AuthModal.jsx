import { useState } from 'react'

function AuthModal({ authOpen, setAuthOpen, authMode, setAuthMode, showPassword, setShowPassword, authError, setAuthError, form, setForm, handleAuthSubmit, player, profileStats, handleSignOut, onUpdateProfile }) {
  const [profileForm, setProfileForm] = useState({ name: null, email: null })
  const [profileError, setProfileError] = useState('')

  if (!authOpen) return null

  if (player) {
    const handleProfileSubmit = (event) => {
      event.preventDefault()
      const error = onUpdateProfile(profileForm.name, profileForm.email)
      setProfileError(error)
      if (!error) setAuthOpen(false)
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
            <label>Gamer tag<input value={profileForm.name ?? player.name} onChange={(event) => setProfileForm({ ...profileForm, name: event.target.value })} autoComplete="username" /></label>
            <label>Email address<input type="email" value={profileForm.email ?? player.email ?? ''} onChange={(event) => setProfileForm({ ...profileForm, email: event.target.value })} autoComplete="email" required /></label>
            {profileError && <p className="auth-error" role="alert">{profileError}</p>}
            <button className="auth-submit" type="submit">Save profile <span>-&gt;</span></button>
          </form>
          <button className="sign-out" type="button" onClick={handleSignOut}>Sign out of {player.name}</button>
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
              <div className="signup-methods" role="group" aria-label="Choose signup method"><button className={form.signupMethod === 'phone' ? 'selected' : ''} type="button" onClick={() => { setForm({ ...form, signupMethod: 'phone' }); setAuthError('') }}>Mobile number</button><button className={form.signupMethod === 'email' ? 'selected' : ''} type="button" onClick={() => { setForm({ ...form, signupMethod: 'email' }); setAuthError('') }}>Gmail / Email</button></div>
              {form.signupMethod === 'phone' ? <label>Mobile number<input type="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="+91 98765 43210" autoComplete="tel" required /></label> : <label>Gmail / Email address<input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="you@gmail.com" autoComplete="email" required /></label>}
              <label>Gamer tag<input value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} placeholder="e.g. ShadowKite" autoComplete="username" required /></label>
              <label>Password<div className="password-field"><input type={showPassword ? 'text' : 'password'} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder="6+ characters" autoComplete="new-password" required /><button type="button" onClick={() => setShowPassword((visible) => !visible)}>{showPassword ? 'Hide' : 'Show'}</button></div></label>
              <button className="auth-submit" type="submit">Create account <span>-&gt;</span></button>
            </>
          )}
          {authMode === 'login' && <><label>{form.loginMethod === 'email' ? 'Gmail / Email address' : 'Mobile number'}<input type={form.loginMethod === 'email' ? 'email' : 'tel'} value={form.loginMethod === 'email' ? form.email : form.phone} onChange={(event) => setForm({ ...form, [form.loginMethod]: event.target.value })} placeholder={form.loginMethod === 'email' ? 'you@gmail.com' : '+91 98765 43210'} autoComplete={form.loginMethod === 'email' ? 'email' : 'tel'} required /></label><label>Password<div className="password-field"><input type={showPassword ? 'text' : 'password'} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder="6+ characters" autoComplete="current-password" required /><button type="button" onClick={() => setShowPassword((visible) => !visible)}>{showPassword ? 'Hide' : 'Show'}</button></div></label><button className="auth-submit" type="submit">Log in <span>-&gt;</span></button></>}
          {authError && <p className="auth-error" role="alert">{authError}</p>}
        </form>
        <p className="auth-switch">{authMode === 'login' ? 'New to ArenaCore?' : 'Already have an account?'} <button type="button" onClick={() => { setAuthMode(authMode === 'login' ? 'signup' : 'login'); setAuthError('') }}>{authMode === 'login' ? 'Sign up' : 'Log in'}</button></p>
        {player && <button className="sign-out" type="button" onClick={handleSignOut}>Sign out of {player.name}</button>}
      </section>
    </div>
  )
}

export default AuthModal
