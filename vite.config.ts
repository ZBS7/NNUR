import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Set BASE to your GitHub repo name, e.g. '/nur-messenger/'
// If deploying to a custom domain or root, set to '/'
const BASE = process.env.VITE_BASE_PATH || '/';

export default defineConfig({
  plugins: [react()],
  base: BASE,
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
