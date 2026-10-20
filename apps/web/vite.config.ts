import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import tailwindcss from '@tailwindcss/vite';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const legalDir = fileURLToPath(new URL('../../static', import.meta.url));
const legalPages: Record<string, string> = {
  '/privacy': 'privacy.html',
  '/terms': 'terms.html',
  '/data-deletion': 'data-deletion.html',
};
const legalTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

// Mirrors the legal-page routes in docker/Caddyfile, so /privacy, /terms and
// /data-deletion (and their /legal/* assets) work on the dev server too.
function legalPagesInDev(): Plugin {
  return {
    name: 'legal-pages-in-dev',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const path = new URL(req.url ?? '/', 'http://localhost').pathname;
        const name = legalPages[path] ?? (path.startsWith('/legal/') ? path.slice(7) : null);
        const file = name ? resolve(legalDir, name) : null;
        const type = file ? legalTypes[extname(file)] : undefined;
        if (!file || !type || !file.startsWith(legalDir + sep)) return next();
        try {
          const body = await readFile(file);
          res.setHeader('Content-Type', type);
          res.end(body);
        } catch {
          next();
        }
      });
    },
  };
}

export default defineConfig({
  // The router plugin must come before react(): it writes src/routeTree.gen.ts
  // from the files in src/routes and splits each route into its own chunk.
  plugins: [
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    legalPagesInDev(),
  ],
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
    allowedHosts: ['.trycloudflare.com', '.ngrok-free.app', '.ngrok-free.dev'],
    // Caddy serves /api on the same origin in every deployed environment; the
    // dev proxy keeps local development identical.
    proxy: { '/api': { target: 'http://localhost:3000', changeOrigin: true } },
  },
  build: { outDir: 'dist', sourcemap: true },
});
