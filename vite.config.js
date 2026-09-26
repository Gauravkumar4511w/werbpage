import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import { defineConfig } from 'vite'
import { handleApiRequest } from './server.js'

function apiDevPlugin() {
  const mountApi = (server) => {
    server.middlewares.use(async (req, res, next) => {
      const url = req.url?.split('?')[0] || ''
      if (url.startsWith('/api')) {
        try {
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
