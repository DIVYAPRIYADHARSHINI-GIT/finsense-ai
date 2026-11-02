import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Vitest config is separate from vite.config.ts so the production build never
// carries test-only settings.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/tests/setup.ts'],
    globals: true,
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
