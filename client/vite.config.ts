import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// https://vitejs.dev/config/
export default defineConfig({
  // rapier2d-compat embeds its WASM as base64 and inits via RAPIER.init(),
  // so no wasm / top-level-await plugins are needed.
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@shared': path.resolve(__dirname, '../shared/src'),
    },
  },
  server: {
    port: 5173,
    host: true, // expose on LAN so phones can hit the dev server
  },
  build: {
    outDir: 'dist',
    target: 'es2022',
    sourcemap: false,
    // CrazyGames wants a flat, relative-path static bundle
    assetsDir: 'assets',
    rollupOptions: {
      output: {
        manualChunks: {
          pixi: ['pixi.js'],
          react: ['react', 'react-dom'],
        },
      },
    },
  },
  base: './',
});
