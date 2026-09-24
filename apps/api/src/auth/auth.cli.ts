import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../database/schema/index.js';
import { createAuth } from './auth.config.js';

/**
 * Entry point for `better-auth generate` only - never imported by the api or
 * the worker.
 *
 * Generating a Drizzle schema is a purely static operation, so this connects to
 * nothing: drizzle.mock() satisfies the adapter without opening a pool or
 * needing credentials, and the settings and mailer are placeholders the CLI
 * never exercises.
 */
export const auth = createAuth({
  db: drizzle.mock({ schema }),
  settings: {
    appUrl: 'http://localhost:5173',
    secret: 'better-auth-cli-schema-generation-only',
    google: { clientId: '', clientSecret: '' },
    facebook: { clientId: '', clientSecret: '' },
  },
  mailer: { dispatch: () => {} },
});
