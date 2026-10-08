import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import './index.css'

// PWA service worker (built by vite-plugin-pwa). Serves the cached app
// shell offline; /api/* requests always bypass it (see vite.config.ts).
registerSW({ immediate: true })

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('Missing #root element')

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
