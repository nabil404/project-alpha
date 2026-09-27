import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  // The router plugin must come before react(): it writes src/routeTree.gen.ts
  // from the files in src/routes and splits each route into its own chunk.
  plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5173,
    // Caddy serves /api on the same origin in every deployed environment; the
    // dev proxy keeps local development identical.
    proxy: { '/api': { target: 'http://localhost:3000', changeOrigin: true } },
  },
  // @app/shared builds to CommonJS (the API consumes it too). Vite serves a
  // linked workspace package raw in dev, where a browser can't read named
  // exports from CJS, so it has to be pre-bundled like any npm dependency.
  // After changing a shared schema: rebuild it, and restart `pnpm dev`.
  optimizeDeps: { include: ['@app/shared'] },
  build: { outDir: 'dist', sourcemap: true },
});
