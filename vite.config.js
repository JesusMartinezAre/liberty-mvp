import { defineConfig } from 'vite';

export default defineConfig({
  // Multi-page app: Vite needs to know about every HTML entry point.
  build: {
    rollupOptions: {
      input: {
        main:         'index.html',
        login:        'auth/login.html',
        callback:     'auth/callback.html',
        samlComplete: 'auth/saml-complete.html',
      },
    },
  },

  // Forward /api and /scim to the local Netlify function runner (netlify dev, port 8888).
  // Without this, `npm run dev` (plain Vite) would 404 on all API calls.
  server: {
    proxy: {
      '/api':  { target: 'http://localhost:8888', changeOrigin: true },
      '/scim': { target: 'http://localhost:8888', changeOrigin: true },
    },
  },
});
