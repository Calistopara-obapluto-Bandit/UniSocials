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
    // Content-hashed names: /assets/* is served with a one-year immutable
    // cache, so a fixed name made every returning browser keep the OLD bundle
    // after a deploy (stale checkout/thank-you UI). index.html is no-cache and
    // picks up the new hashed name each deploy; server.js serves whatever
    // files live under dist/assets, so hashed names route identically.
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]'
      }
    },
    minify: 'terser',
    sourcemap: false
  },
  server: {
    hmr: false
  }
});