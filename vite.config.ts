import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // For GitHub Pages: set to '/YOUR_REPO_NAME/'
  // For local dev or custom domain: set to '/'
  base: process.env.VITE_BASE_PATH ?? '/',
  server: {
    host: '0.0.0.0',
    port: 5174,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          peerjs: ['peerjs'],
          dexie: ['dexie'],
        },
      },
    },
  },
});
