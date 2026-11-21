import assert from 'node:assert/strict'
import { test } from 'node:test'
import { INSTALL_STEPS, getInstallPlatform } from '../src/installHelp.js'

const platform = (userAgent, extra = {}) => getInstallPlatform({ userAgent, ...extra })

test('install steps match the phone or browser the site is open in', () => {
  assert.equal(platform('Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1'), 'ios-safari')
  assert.equal(platform('Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0 Mobile/15E148 Safari/604.1'), 'ios-chrome')
  assert.equal(platform('Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0'), 'ios-other')
  assert.equal(platform('Mozilla/5.0 (Linux; Android 14; SM-A146B Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0 Mobile Safari/537.36 WhatsApp/2.24'), 'in-app')
  assert.equal(platform('Mozilla/5.0 (Linux; Android 14; SM-A146B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36 [FBAN/EMA;FBAV/400.0]'), 'in-app')
  assert.equal(platform('Mozilla/5.0 (Linux; Android 14; SM-A146B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36'), 'android')
  assert.equal(platform('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'), 'desktop')
  // An iPad asking for the desktop site still counts as iOS.
  assert.equal(platform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15', { maxTouchPoints: 5 }), 'ios-safari')
  assert.equal(platform('anything', { standalone: true }), 'installed')
  for (const key of ['ios-safari', 'ios-chrome', 'ios-other', 'in-app', 'android', 'desktop']) assert.ok(INSTALL_STEPS[key].steps.length >= 2, key)
})
