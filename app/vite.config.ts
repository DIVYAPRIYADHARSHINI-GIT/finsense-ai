import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'

// Static-only build: no server routes, no env vars, no API keys.
// `base` is settable so the same bundle deploys to Vercel (root) or GitHub
// Pages (/repo-name/) unchanged: BASE_PATH=/finsense-ai/ npm run build
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react(), tailwind()],
  build: {
    chunkSizeWarningLimit: 1200,
  },
  worker: { format: 'es' },
  optimizeDeps: {
    // The worker imports pyodide dynamically and Pyodide loads its own wheels
    // from the CDN at runtime; pre-bundling its Node entry points breaks that.
    exclude: ['pyodide'],
  },
})
