import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // manifest.webmanifest is hand-written in public/ (relative paths so it
      // works whether the app is served from a domain root, a sub-path, or
      // wrapped by Capacitor) — skip the plugin's own manifest generation.
      manifest: false,
      injectRegister: 'auto',
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.png'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,webmanifest}'],
      },
    }),
  ],
  base: './',
  server: {
    host: true,
    port: 5173,
  },
})
