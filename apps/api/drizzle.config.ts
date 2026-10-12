import { defineConfig } from 'drizzle-kit';

// environments/.env is the repo's only env file and cwd here is apps/api. drizzle-kit
// does not load it on its own, and DATABASE_ADMIN_URL lives only there.
try {
  process.loadEnvFile('../../environments/.env');
} catch {
  // no environments/.env here
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/modules/database/schema/index.ts',
  out: './db/migrations',
  dbCredentials: { url: process.env.DATABASE_ADMIN_URL ?? '' },
  // The runtime role is created by db/migrations (and docker/postgres-init on a
  // fresh volume), not by drizzle-kit. Leaving role management off stops it
  // generating DROP ROLE for a role it did not create.
  entities: { roles: false },
  verbose: true,
  strict: true,
});
