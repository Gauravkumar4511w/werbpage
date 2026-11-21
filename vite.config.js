import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

function apiDevPlugin() {
  const mountApi = (server) => {
    server.middlewares.use(async (req, res, next) => {
      const url = req.url?.split('?')[0] || ''
      if (url.startsWith('/api')) {
        try {
          // Loaded on first request so `vite build` never opens the SQLite database.
          const { handleApiRequest } = await import('./server.js')
          await handleApiRequest(req, res)
        } catch (error) {
          console.error('API Error in dev server:', error)
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ message: error.message || 'Internal API error' }))
          }
        }
        return
      }
      next()
    })
  }
  return {
    name: 'api-dev-plugin',
    configureServer: mountApi,
    configurePreviewServer: mountApi,
  }
}

// https://vite.dev/config/
export default defineConfig({
  server: {
    port: 5173,
  },
  build: {
    cssMinify: false,
  },
  plugins: [
    apiDevPlugin(),
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    // Makes the site installable from Chrome ("Install ArenaCore" in the address bar / menu).
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        id: '/',
        name: 'ArenaCore',
        short_name: 'ArenaCore',
        description: 'Free Fire matches, tournaments and coin wallet.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        display_override: ['standalone'],
        orientation: 'any',
        background_color: '#070b10',
        theme_color: '#070b10',
        categories: ['games', 'sports'],
        // Installed on Android, links to the site open in the app, and tapping the icon again goes
        // back to the open app instead of a second copy.
        handle_links: 'preferred',
        launch_handler: { client_mode: ['navigate-existing', 'auto'] },
        // Long-press the app icon for these.
        shortcuts: [
          { name: 'Matches', short_name: 'Matches', url: '/#tournaments', icons: [{ src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' }] },
          { name: 'My Matches', short_name: 'My Matches', url: '/#my-matches', icons: [{ src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' }] },
        ],
        icons: [
          { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: '/maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Only the app shell is cached. Wallet, matches and login always go to the network.
        globPatterns: ['**/*.{js,css,html,svg,png,jpg,webp,woff2}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/privacy\.html$/, /^\/terms\.html$/],
        // Shows phone notifications sent by the server (coins added, room ready).
        importScripts: ['/push-sw.js'],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
      },
    }),
  ],
})
