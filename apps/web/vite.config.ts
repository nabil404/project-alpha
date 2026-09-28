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
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // The SPA bundles @app/shared from its TypeScript source rather than its
      // built dist/. dist/ is CommonJS (the API consumes it), which a browser
      // can't read named exports from in dev, and a pre-bundled copy of it goes
      // stale on every rebuild. Typecheck still reads dist/'s declarations, so
      // `pnpm --filter @app/shared build` after a schema change still applies.
      '@app/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    // HTTPS tunnels for Facebook's redirects and the Messenger webhook in
    // development; see docs/setup/meta-setup.md, "HTTPS through a tunnel".
    allowedHosts: ['.trycloudflare.com', '.ngrok-free.app','.ngrok-free.dev'],
    // Caddy serves /api on the same origin in every deployed environment; the
    // dev proxy keeps local development identical.
    proxy: { '/api': { target: 'http://localhost:3000', changeOrigin: true } },
  },
  build: { outDir: 'dist', sourcemap: true },
});
