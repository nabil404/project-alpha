import { betterAuth } from 'better-auth';
import { organization } from 'better-auth/plugins';
import { Kysely, PostgresDialect } from 'kysely';
import type { DB } from '../database/database.types.js';
import { Pool } from 'pg';

/**
 * Sessions and users live in our own Postgres. Better Auth uses Kysely
 * natively and shares the API's pool at runtime; this standalone instance
 * exists so the Better Auth CLI can generate SQL into the auth section of
 * db/schema.sql.
 */
export function createAuth(db: Kysely<DB>) {
  return betterAuth({
    database: { db, type: 'postgres' },
    baseURL: process.env.APP_URL,
    secret: process.env.BETTER_AUTH_SECRET,
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
    },
    socialProviders: {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID ?? '',
        clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
        // Google guarantees a verified email, so it may link to an existing account.
        mapProfileToUser: (profile) => ({ email: profile.email }),
      },
      facebook: {
        clientId: process.env.FACEBOOK_CLIENT_ID ?? '',
        clientSecret: process.env.FACEBOOK_CLIENT_SECRET ?? '',
        // Sign-in asks for public_profile and email only. Page permissions are
        // requested later, in the separate Page connection flow.
        scopes: ['public_profile', 'email'],
      },
    },
    account: {
      accountLinking: {
        enabled: true,
        // Facebook does not guarantee a verified email: it is linked only
        // explicitly, from account settings.
        trustedProviders: ['google'],
      },
    },
    plugins: [organization()],
  });
}

/** Entry point for `better-auth generate`. */
export const auth = createAuth(
  new Kysely<DB>({
    dialect: new PostgresDialect({
      pool: new Pool({ connectionString: process.env.DATABASE_URL }),
    }),
  }),
);
