import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../database/schema/index';
import { createAuth } from './auth.config';

/**
 * Entry point for `better-auth generate` only. Generating the schema is static,
 * so drizzle.mock() stands in for the database and the settings and mailer are
 * placeholders.
 */
export const auth = createAuth({
  db: drizzle.mock({ schema }),
  settings: {
    appUrl: 'http://localhost:5173',
    secret: 'better-auth-cli-schema-generation-only',
    google: { clientId: '', clientSecret: '' },
    facebook: { clientId: '', clientSecret: '' },
    rateLimit: false,
  },
  mailer: { dispatch: () => {} },
});
