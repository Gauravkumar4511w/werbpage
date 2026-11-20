import { useInstallPrompt } from '../installPrompt.js'

// Icons for the phone dock, drawn with one stroke so they take the tab's colour.
const dockIcons = {
  profile: <><circle cx="12" cy="8.5" r="4" /><path d="M4.5 20c.9-3.9 3.9-6 7.5-6s6.6 2.1 7.5 6" /></>,
  history: <><path d="M3.5 12a8.5 8.5 0 1 0 2.5-6" /><path d="M3.5 4.5V9H8" /><path d="M12 7.5V12l3 2" /></>,
  matches: <><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2.5" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" /></>,
  mine: <><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5h11A2.5 2.5 0 0 1 20 7.5v2a2.5 2.5 0 0 0 0 5v2a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5v-2a2.5 2.5 0 0 0 0-5v-2Z" /><path d="M10 9.5h4M10 14.5h4" /></>,
}

function Navbar({ menuOpen, setMenuOpen, player, setAuthOpen, accountOpen = false, onHome, onHistory, libraryOpen, tournamentsOpen, myMatchesOpen, onMyMatches, upcomingMatchCount, onTournaments, onCoinClick, coinBalance, onAdmin, playerLevel = 1 }) {
  const closeMenu = () => setMenuOpen(false)
  const openWallet = () => { closeMenu(); onCoinClick() }
  const openAccount = () => { closeMenu(); setAuthOpen(true) }
  const initials = player ? player.name.slice(0, 2).toUpperCase() : 'AC'
  const { canInstall, install } = useInstallPrompt()
  const installApp = () => { closeMenu(); install() }
  const dockTabs = [
    { key: 'profile', label: 'Profile', href: '#profile', onClick: (event) => { event.preventDefault(); openAccount() }, active: accountOpen },
    { key: 'history', label: 'History', href: '#library', onClick: onHistory, active: !accountOpen && libraryOpen },
    { key: 'matches', label: 'Matches', href: '#tournaments', onClick: onTournaments, active: !accountOpen && tournamentsOpen },
    { key: 'mine', label: 'My Matches', href: '#my-matches', onClick: onMyMatches, active: !accountOpen && myMatchesOpen, badge: upcomingMatchCount },
  ]
  // On Discover no tab is open, so the pill hides until one is.
  const activeTab = dockTabs.findIndex((tab) => tab.active)

  return (
    <>
    <nav className="navbar" aria-label="Main navigation">
      <a className="brand" href="#top" aria-label="ArenaCore home" onClick={onHome}>
        <span className="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>
        <span>ARENA<span className="brand-dot">CORE.</span></span>
      </a>

      {/* On phones the wallet and account stay one tap away in the bar; the menu holds the rest. */}
      <div className="nav-quick">
        <button className="coin-balance" type="button" aria-label="Open coin wallet" onClick={openWallet}>
          <span className="coin-icon" aria-hidden="true"></span><strong>{coinBalance.toLocaleString()}</strong><small>COINS</small>
        </button>
        {canInstall && (
          <button className="quick-install" type="button" aria-label="Install app" onClick={installApp}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14" /></svg>
          </button>
        )}
        <button className="quick-avatar" type="button" aria-label="Open account" onClick={openAccount}>
          <span className="avatar">{initials}</span>
        </button>
      </div>

      <button
        className="menu-toggle"
        type="button"
        aria-expanded={menuOpen}
        aria-controls="primary-navigation"
        onClick={() => setMenuOpen((open) => !open)}
      >
        <span></span><span></span><span></span>
        <span className="sr-only">Toggle menu</span>
      </button>

      <div id="primary-navigation" className={`nav-content${menuOpen ? ' is-open' : ''}`}>
        <div className="nav-links">
          <a className={`nav-link${!libraryOpen && !tournamentsOpen && !myMatchesOpen ? ' active' : ''}`} href="#discover" onClick={onHome}>Discover</a>
          <a className={`nav-link${libraryOpen ? ' active' : ''}`} href="#library" onClick={onHistory}>History</a>
          <a className={`nav-link${tournamentsOpen ? ' active' : ''}`} href="#tournaments" onClick={onTournaments}>Matches</a>
          <a className={`nav-link${myMatchesOpen ? ' active' : ''}`} href="#my-matches" onClick={onMyMatches}>My Matches{upcomingMatchCount > 0 && <span className="my-matches-count" aria-label={`${upcomingMatchCount} upcoming`}>{upcomingMatchCount}</span>}</a>
        </div>
        <div className="nav-actions">
          {canInstall && <button className="admin-link install-app" type="button" onClick={installApp}>Install app</button>}
          <button className="admin-link" type="button" onClick={onAdmin}>Admin</button>
          <button className="icon-button search-button" type="button" aria-label="Open match history" onClick={onHistory}>
            <span aria-hidden="true"></span>
          </button>
          <button className="coin-balance" type="button" aria-label="Open coin wallet" onClick={openWallet}>
            <span className="coin-icon" aria-hidden="true"></span><strong>{coinBalance.toLocaleString()}</strong><small>COINS</small>
          </button>
          <button className="profile-button" type="button" aria-label="Open account" onClick={openAccount}>
            <span className="avatar">{initials}</span>
            <span className="profile-copy"><strong>{player ? player.name : 'ArenaCore'}</strong><small>{player ? `LVL ${String(playerLevel).padStart(2, '0')}` : 'SIGN IN'}</small></span>
            <span className="chevron" aria-hidden="true"></span>
          </button>
        </div>
      </div>
      {menuOpen && <button className="nav-scrim" type="button" aria-label="Close menu" onClick={closeMenu} />}
    </nav>

    {/* Phones get the four main pages in a dock at the bottom, in thumb reach. It sits outside the
        top bar, whose backdrop blur would otherwise pin it to the bar. */}
    <nav className={`phone-dock${activeTab < 0 ? ' is-idle' : ''}`} aria-label="Quick navigation" style={{ '--dock-index': Math.max(0, activeTab) }}>
      <span className="phone-dock-glow" aria-hidden="true" />
      {dockTabs.map((tab) => (
        <a
          key={tab.key}
          className={`phone-dock-tab${tab.active ? ' is-active' : ''}`}
          href={tab.href}
          aria-current={tab.active ? 'page' : undefined}
          onClick={(event) => { closeMenu(); tab.onClick(event) }}
        >
          <span className="phone-dock-icon">
            <svg viewBox="0 0 24 24" aria-hidden="true">{dockIcons[tab.key]}</svg>
            {tab.badge > 0 && <span className="phone-dock-badge" aria-label={`${tab.badge} upcoming`}>{tab.badge}</span>}
          </span>
          <span className="phone-dock-label">{tab.label}</span>
        </a>
      ))}
    </nav>
    </>
  )
}

export default Navbar
