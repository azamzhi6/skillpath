import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// SkillPath prototype — local only. Dev server defaults to http://localhost:5173
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // PWA: precache the app shell + hashed assets. The service worker never
    // touches /api/* (network-only by exclusion): no API caching, no offline
    // write queue — the existing localStorage/offline behavior is unchanged.
    VitePWA({
      registerType: 'autoUpdate',
      // Registration is manual in src/main.tsx; the plugin only builds sw.js.
      injectRegister: false,
      // Static manifest is served from public/manifest.webmanifest.
      manifest: false,
      workbox: {
        navigateFallback: 'index.html',
        // Direct navigations to /api/* (e.g. opening /api/health in a tab)
        // must reach the Netlify Function, never the cached shell.
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  server: {
    port: 5173,
    host: 'localhost',
    proxy: {
      '/api': 'http://localhost:5174',
    },
  },
  preview: {
    port: 5173,
    host: 'localhost',
  },
})
