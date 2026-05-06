import { defineConfig } from 'vite';

export default defineConfig({
  // Multi-page app: Vite needs to know about every HTML entry point.
  build: {
    rollupOptions: {
      input: {
        main:  'index.html',
        login: 'auth/login.html',
      },
    },
  },
});
