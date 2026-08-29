/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// Publiceras på GitHub Pages under repo-namnet. Basepath måste matcha repot,
// annars 404:ar alla assets i produktion. Dev-servern kör alltid från roten.
const BASE = '/middagsdepartementet/'

export default defineConfig(({ command, isPreview }) => ({
  // Dev-servern kör från roten så att basadressen aldrig är i vägen lokalt.
  // Förhandsgranskningen måste däremot använda samma bas som bygget - annars
  // hittar den inte sina egna assets, och `npm run preview` blir värdelös som
  // kontroll av det som faktiskt publiceras. `preview` kör med command
  // 'serve', så det räcker inte att titta på command.
  base: command === 'build' || isPreview ? BASE : '/',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Departementet för middagsfrågor',
        short_name: 'Middagsdep.',
        description: 'Samordnad livsmedelsförsörjning för hushållet.',
        lang: 'sv-SE',
        theme_color: '#1f4e5f',
        background_color: '#faf9f6',
        display: 'standalone',
        start_url: BASE,
        scope: BASE,
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Inköpslistan och veckoplanen måste gå att läsa i butiken med dålig
        // täckning. Supabase-anrop cachas network-first så färsk data vinner
        // när den finns, men gammal data visas hellre än ingenting.
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*\.supabase\.co\/rest\/v1\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'supabase-rest',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 7 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  test: {
    // jsdom behovs for komponenttesterna; domantesterna bryr sig inte.
    environment: 'jsdom',
    globals: false,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      include: ['src/domain/**'],
    },
  },
}))
