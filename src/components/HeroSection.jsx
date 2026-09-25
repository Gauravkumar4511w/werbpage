function HeroSection({ openTournaments, registeredAccountCount }) {
  return (
    <section className="nav-showcase" id="top">
      <p className="eyebrow"><span></span> Your next obsession awaits</p>
      <h1>PLAY <em>BEYOND</em><br />THE ORDINARY.</h1>
      <p className="showcase-copy">Discover worlds worth getting lost in, compete with the best, and make every session count.</p>
      <div className="showcase-actions">
        <a className="primary-cta" href="#tournaments" onClick={openTournaments}>Explore games <span aria-hidden="true">-&gt;</span></a>
        <a className="secondary-cta" href="#trending">View trending</a>
      </div>
      <div className="status-bar"><span className="status-pulse"></span> {(registeredAccountCount * 51).toLocaleString()} players online <span className="status-divider"></span> Season 08 is live</div>
    </section>
  )
}

export default HeroSection
