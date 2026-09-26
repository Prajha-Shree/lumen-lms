import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const backend = process.env.BACKEND_PROXY_TARGET ?? 'http://localhost:4000';

/** Course material a learner may want to re-read offline (GET only). */
const COURSE_CONTENT = /^\/api\/(courses(\/[0-9a-f-]{36})?|lessons\/[0-9a-f-]{36})$/;

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'Lumen LMS',
        short_name: 'Lumen',
        description: 'Adaptive learning for every institution.',
        theme_color: '#5b4de0',
        background_color: '#f9f9fc',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        // Never serve the SPA shell for API or realtime URLs.
        navigateFallbackDenylist: [/^\/api\//, /^\/socket\.io/],
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        runtimeCaching: [
          {
            // Network-first: always fresh online, last-seen copy offline. Auth,
            // proctoring, exams and everything else are never cached. The cache is
            // cleared on logout (AuthProvider) so shared devices don't leak content.
            urlPattern: ({ url, request }) => request.method === 'GET' && url.origin === self.location.origin && COURSE_CONTENT.test(url.pathname),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'lms-course-content',
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 200, maxAgeSeconds: 7 * 24 * 3600 },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5173,
    host: true,
    // Docker on Windows doesn't forward file events into the container.
    watch: process.env.VITE_USE_POLLING ? { usePolling: true, interval: 300 } : undefined,
    // Same-origin API calls in dev: no CORS, and refresh-token cookies just work.
    proxy: {
      '/api': { target: backend, changeOrigin: true },
      '/socket.io': { target: backend, changeOrigin: true, ws: true },
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Long-lived vendor chunks cache well across deploys.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          const groups: [string, RegExp][] = [
            ['react', /[\\/]node_modules[\\/](react|react-dom|scheduler|react-router|cookie|set-cookie-parser)[\\/]/],
            ['charts', /[\\/]node_modules[\\/](recharts|d3-[^\\/]+|victory-vendor|decimal\.js-light|es-toolkit|immer|reselect|redux|@reduxjs|react-redux|use-sync-external-store)[\\/]/],
            ['motion', /[\\/]node_modules[\\/](motion|framer-motion|motion-dom|motion-utils)[\\/]/],
            ['radix', /[\\/]node_modules[\\/](radix-ui|@radix-ui|@floating-ui|aria-hidden|react-remove-scroll[^\\/]*|use-callback-ref|use-sidecar|detect-node-es|get-nonce|tslib)[\\/]/],
            ['forms', /[\\/]node_modules[\\/](react-hook-form|@hookform|zod)[\\/]/],
            ['data', /[\\/]node_modules[\\/](@tanstack|socket\.io-client|engine\.io-client|socket\.io-parser|engine\.io-parser|@socket\.io|sonner|debug|ms|xmlhttprequest-ssl|ws)[\\/]/],
            ['icons', /[\\/]node_modules[\\/]lucide-react[\\/]/],
          ];
          return groups.find(([, re]) => re.test(id))?.[0];
        },
      },
    },
  },
});
