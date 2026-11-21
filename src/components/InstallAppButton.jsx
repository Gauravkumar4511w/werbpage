import { useInstallPrompt } from '../installPrompt.js'

// Opens Chrome's "Install app" dialog. Shown only when Chrome offers it: not once the app is
// installed, and not in browsers that cannot install the site.
function InstallAppButton({ className = '' }) {
  const { canInstall, install } = useInstallPrompt()
  if (!canInstall) return null
  return (
    <button className={`install-app-cta ${className}`.trim()} type="button" onClick={install}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5v11M7.5 10 12 14.5 16.5 10M5 19.5h14" /></svg>
      <span><strong>Install ArenaCore app</strong><small>Open it from your home screen, like any app</small></span>
    </button>
  )
}

export default InstallAppButton
