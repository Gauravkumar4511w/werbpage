import { useState } from 'react'
import { useInstallPrompt } from '../installPrompt.js'
import { INSTALL_STEPS, currentInstallPlatform } from '../installHelp.js'

// Install button for the login screen. Chrome's own install dialog opens when Chrome offers it;
// otherwise (iPhone, WhatsApp/Instagram browsers, or Chrome not offering yet) a tap shows the steps
// for that phone or browser. Hidden once the site runs as the installed app.
function InstallAppButton({ className = '' }) {
  const { canInstall, install } = useInstallPrompt()
  const [platform] = useState(currentInstallPlatform)
  const [helpOpen, setHelpOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  if (platform === 'installed') return null
  const help = INSTALL_STEPS[platform] || INSTALL_STEPS.desktop

  const onTap = () => {
    if (canInstall) install()
    else setHelpOpen(true)
  }
  const copyLink = async () => {
    const link = window.location.origin + '/'
    try {
      await navigator.clipboard.writeText(link)
    } catch {
      const box = document.createElement('textarea')
      box.value = link
      box.style.position = 'fixed'
      box.style.opacity = '0'
      document.body.appendChild(box)
      box.select()
      document.execCommand('copy')
      box.remove()
    }
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  return (
    <>
      <button className={`install-app-cta ${className}`.trim()} type="button" onClick={onTap}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5v11M7.5 10 12 14.5 16.5 10M5 19.5h14" /></svg>
        <span><strong>Install ArenaCore app</strong><small>Open it from your home screen, like any app</small></span>
      </button>
      {helpOpen && (
        <div className="install-help-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setHelpOpen(false)}>
          <section className="install-help" role="dialog" aria-modal="true" aria-labelledby="install-help-title">
            <button className="install-help-close" type="button" aria-label="Close" onClick={() => setHelpOpen(false)}>×</button>
            <h3 id="install-help-title">{help.title}</h3>
            <ol>{help.steps.map((step) => <li key={step}>{step}</li>)}</ol>
            {help.copyLink && <button className="install-help-copy" type="button" onClick={copyLink}>{copied ? 'Link copied' : 'Copy link'}</button>}
          </section>
        </div>
      )}
    </>
  )
}

export default InstallAppButton
