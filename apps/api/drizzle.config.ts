import { defineConfig } from 'drizzle-kit';

// apps/api/.env is the repo's only env file and cwd here is apps/api. drizzle-kit
// does not load it on its own, and DATABASE_ADMIN_URL lives only there.
try {
  process.loadEnvFile('.env');
} catch {
  // no .env here
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/database/schema/index.ts',
  out: './db/migrations',
  dbCredentials: { url: process.env.DATABASE_ADMIN_URL ?? '' },
  // The runtime role is created by db/migrations (and docker/postgres-init on a
  // fresh volume), not by drizzle-kit. Leaving role management off stops it
  // generating DROP ROLE for a role it did not create.
  entities: { roles: false },
  verbose: true,
  strict: true,
});
