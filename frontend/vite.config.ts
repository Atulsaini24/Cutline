import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

// `npm run dev` proxies /api and /ws to the backend on :8787.
// `npm run build:single` produces one self-contained HTML file (offline demo mode) in dist-single/.
export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === 'single' ? [viteSingleFile()] : [])],
  base: mode === 'single' ? './' : '/',
  server: {
    fs: { allow: ['..'] },
    proxy: { '/api': 'http://localhost:8787', '/ws': { target: 'ws://localhost:8787', ws: true } },
  },
  build: mode === 'single' ? { outDir: 'dist-single', chunkSizeWarningLimit: 4000 } : { chunkSizeWarningLimit: 1600 },
}))
