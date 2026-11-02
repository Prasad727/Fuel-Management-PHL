import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// While you work on the app (npm run dev), API calls go to your Node server on port 3000.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/phl-logo.png': 'http://localhost:3000',
      '/login': 'http://localhost:3000'
    }
  },
  build: { outDir: 'dist', chunkSizeWarningLimit: 1200 }
});
