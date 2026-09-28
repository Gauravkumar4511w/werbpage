import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import { defineConfig } from 'vite'

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
  ],
})
