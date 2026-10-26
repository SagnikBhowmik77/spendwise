import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Link previews (WhatsApp, LinkedIn, X) need absolute addresses, so index.html says __SITE_URL__
// and the build fills in VITE_SITE_URL: the address the app is served from.
function siteUrl(mode) {
  const url = (loadEnv(mode, process.cwd(), 'VITE_').VITE_SITE_URL || 'http://localhost:5200').replace(/\/+$/, '');
  return { name: 'spendwise-site-url', transformIndexHtml: (html) => html.replaceAll('__SITE_URL__', url) };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), siteUrl(mode)],
  server: {
    port: 5200,
    strictPort: true,
    // Windows 8.3 short paths (SAGNIK~1) make Vite reject its own files otherwise.
    fs: { strict: false },
    // In dev the client calls /api/* on its own origin; Vite forwards it to the API.
    proxy: { '/api': 'http://localhost:8730' },
  },
  // `npm run preview` serves the production build (service worker on) against the local API.
  preview: {
    port: 5201,
    strictPort: true,
    proxy: { '/api': 'http://localhost:8730' },
  },
}));
