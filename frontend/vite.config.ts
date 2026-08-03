import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

import { akoolProxyPlugin } from './vite-plugin-akool.js'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    base: process.env.VITE_BASE_PATH || '/',
    plugins: [
      react(),
      tailwindcss(),
      akoolProxyPlugin({
        apiKey: env.AKOOL_API_KEY,
        supabaseUrl: env.SUPABASE_URL,
        supabaseAnonKey: env.SUPABASE_ANON_KEY,
      }),
    ],
    server: {
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      },
      // Explicit HMR endpoint — avoids reconnect failures after BFCache / tab restore.
      hmr: {
        host: 'localhost',
        port: 5173,
        clientPort: 5173,
      },
    },
    preview: {
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      },
    },
    optimizeDeps: {
      exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
    },
  }
})
