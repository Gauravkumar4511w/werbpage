function Navbar({ menuOpen, setMenuOpen, player, setAuthOpen, onHome, onHistory, libraryOpen, tournamentsOpen, onTournaments, onCoinClick, coinBalance, onAdmin }) {
  return (
    <nav className="navbar" aria-label="Main navigation">
      <a className="brand" href="#top" aria-label="ArenaCore home" onClick={onHome}>
        <span className="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>
        <span>ARENA<span className="brand-dot">CORE.</span></span>
      </a>

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
          <a className={`nav-link${!libraryOpen && !tournamentsOpen ? ' active' : ''}`} href="#discover" onClick={onHome}>Discover</a>
          <a className={`nav-link${libraryOpen ? ' active' : ''}`} href="#library" onClick={onHistory}>History</a>
          <a className="nav-link" href="#community">Community</a>
          <a className={`nav-link${tournamentsOpen ? ' active' : ''}`} href="#tournaments" onClick={onTournaments}>Matches <span className="live-dot">LIVE</span></a>
        </div>
        <div className="nav-actions">
          <button className="admin-link" type="button" onClick={onAdmin}>Admin</button>
          <button className="icon-button search-button" type="button" aria-label="Open match history" onClick={onHistory}>
            <span aria-hidden="true"></span>
          </button>
          <button className="coin-balance" type="button" aria-label="Open coin wallet" onClick={onCoinClick}>
            <span className="coin-icon" aria-hidden="true"></span><strong>{coinBalance.toLocaleString()}</strong><small>COINS</small>
          </button>
          <button className="profile-button" type="button" aria-label="Open account" onClick={() => { setMenuOpen(false); setAuthOpen(true) }}>
            <span className="avatar">{player ? player.name.slice(0, 2).toUpperCase() : 'AC'}</span>
            <span className="profile-copy"><strong>{player ? player.name : 'ArenaCore'}</strong><small>{player ? 'LVL 01' : 'SIGN IN'}</small></span>
            <span className="chevron" aria-hidden="true"></span>
          </button>
        </div>
      </div>
    </nav>
  )
}

export default Navbar
