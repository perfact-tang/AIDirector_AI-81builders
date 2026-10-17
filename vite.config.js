import { defineConfig } from 'vite';
export default defineConfig({
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        // Preserve the browser-facing Host so the API can compare it to Origin.
        changeOrigin: false,
      },
    },
  },
});
