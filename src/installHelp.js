// Where the player is opening the site, to show the right way to install it when Chrome does not
// offer its own install dialog. Pure, so it can be tested with any user agent.
//
//   installed  - already running as the installed app
//   ios-safari - iPhone/iPad Safari: Share, then Add to Home Screen
//   ios-chrome - iPhone/iPad Chrome, Edge or Firefox: their Share button, then Add to Home Screen
//   ios-other  - iPhone/iPad inside an app (WhatsApp, Instagram...): open in Safari first
//   in-app     - inside WhatsApp, Instagram, Facebook...: open in Chrome first
//   android    - Android Chrome or similar: the menu's Install app / Add to Home screen
//   desktop    - a computer: the install icon in the address bar or the browser menu
export function getInstallPlatform({ userAgent = '', standalone = false, maxTouchPoints = 0 } = {}) {
  if (standalone) return 'installed'
  const ua = userAgent
  const inApp = /(FBAN|FBAV|FB_IAB|Instagram|WhatsApp|Line\/|Snapchat|Twitter|LinkedInApp|GSA\/|; wv\))/i.test(ua)
  const ios = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && maxTouchPoints > 1)
  if (ios) {
    if (inApp) return 'ios-other'
    if (/(CriOS|FxiOS|EdgiOS)/i.test(ua)) return 'ios-chrome'
    return /Safari/i.test(ua) && !/OPiOS/i.test(ua) ? 'ios-safari' : 'ios-other'
  }
  if (inApp) return 'in-app'
  if (/Android/i.test(ua)) return 'android'
  return 'desktop'
}

export function currentInstallPlatform() {
  if (typeof window === 'undefined') return 'desktop'
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true
  return getInstallPlatform({ userAgent: window.navigator.userAgent, standalone, maxTouchPoints: window.navigator.maxTouchPoints || 0 })
}

export const INSTALL_STEPS = {
  'ios-safari': {
    title: 'Install on iPhone',
    steps: ['Tap the Share button at the bottom of Safari (the square with an arrow).', 'Scroll and tap "Add to Home Screen".', 'Tap "Add". ArenaCore appears on your home screen and opens full screen, like any app.'],
  },
  'ios-chrome': {
    title: 'Install on iPhone',
    steps: ['Tap the Share button at the top right, in the address bar.', 'Tap "Add to Home Screen" (iOS 16.4 or newer), then "Add".', 'No "Add to Home Screen"? Copy the link, open it in Safari, and use Safari\'s Share button.'],
    copyLink: true,
  },
  'ios-other': {
    title: 'Open in Safari to install',
    steps: ['iPhone can only install apps from Safari.', 'Copy the link below and open it in Safari.', 'Then tap Share and "Add to Home Screen".'],
    copyLink: true,
  },
  'in-app': {
    title: 'Open in Chrome to install',
    steps: ['This page is open inside another app (like WhatsApp or Instagram), which cannot install apps.', 'Tap the menu (⋮ or ...) and choose "Open in Chrome" or "Open in browser". Or copy the link below and paste it in Chrome.', 'In Chrome, tap Install ArenaCore app again.'],
    copyLink: true,
  },
  android: {
    title: 'Install from the Chrome menu',
    steps: ['Tap the menu (⋮) at the top right of Chrome.', 'Tap "Install app" or "Add to Home screen".', 'Tap "Install". ArenaCore appears with your apps.'],
  },
  desktop: {
    title: 'Install on this computer',
    steps: ['Click the install icon at the right end of the address bar.', 'Or open the browser menu (⋮) and choose "Install ArenaCore".', 'Click "Install".'],
  },
}
