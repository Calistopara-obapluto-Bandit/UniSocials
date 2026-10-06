// Vite config for the React app.
//
// The Node server (server.js) serves the built output from dist/ and falls back
// to the original .html pages for every route that has not been migrated yet, so
// both versions of the site are live at the same time during the migration.
//
// HMR is disabled deliberately: the Freebuff preview runs `npm start`
// (node server.js), which serves the static build, never the Vite dev server.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'app',
  base: '/',
  publicDir: false,
  plugins: [react()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    // Predictable names keep server.js's asset routing simple and readable in
    // logs when something 404s.
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]'
      }
    },
    minify: 'terser',
    sourcemap: false
  },
  server: {
    hmr: false
  }
});