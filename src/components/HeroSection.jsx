function HeroSection({ openTournaments, openMyMatches, totalAccounts = 0 }) {
  const displayCount = Math.max(0, Number(totalAccounts) || 0)
  return (
    <section className="nav-showcase" id="top">
      <div className="showcase-actions">
        <a className="primary-cta" href="#tournaments" onClick={openTournaments}>Explore games <span aria-hidden="true">-&gt;</span></a>
        <a className="secondary-cta" href="#my-matches" onClick={openMyMatches}>My matches</a>
      </div>
      <div className="status-bar"><span className="status-pulse"></span> {displayCount.toLocaleString()} {displayCount === 1 ? 'player' : 'players'} registered</div>
    </section>
  )
}

export default HeroSection
