import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// PWA (import-candidate-features.md §4.3 Phase 2): installable manifest +
// offline shell. vite-plugin-pwa wraps Workbox — the same engine ezBookkeeping's
// src/sw.ts uses (MIT) — but our service worker stays minimal: precache the
// built app, fall back to /index.html for navigation (offline shell), and cache
// Supabase REST GETs NetworkFirst so the last-loaded data is viewable offline.
// The dashboard's data is RLS-scoped and already sanitized on the server
// (agents.md §8), so what lands in Cache Storage is what the dashboard itself
// renders. Dev is unaffected: the plugin only emits on build.
export default defineConfig({
  build: {
    outDir: 'dist',
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['red-cross-mark.png', 'icon.svg'],
      manifest: {
        name: 'Expense Tracker',
        short_name: 'Tracker',
        description: 'Notification-based expense tracker',
        lang: 'en',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#000000',
        theme_color: '#000000',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        runtimeCaching: [
          {
            // Supabase REST reads only (never /auth/v1/*, never writes).
            urlPattern: ({ url }) =>
              url.pathname.startsWith('/rest/v1/') && /supabase\.co$/.test(url.hostname),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'supabase-reads',
              networkTimeoutSeconds: 3,
              expiration: {
                maxEntries: 30,
                maxAgeSeconds: 7 * 24 * 60 * 60, // 7 days
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
});