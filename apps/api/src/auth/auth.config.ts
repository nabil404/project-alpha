import { betterAuth } from 'better-auth';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { organization } from 'better-auth/plugins';
import type { Database } from '../database/database.module.js';
import {
  ensureOrganizationForUser,
  ensureOrganizationForUserId,
} from '../database/ensure-organization.js';
import * as schema from '../database/schema/index.js';

/**
 * Sessions and users live in our own Postgres. Better Auth shares the API's
 * Drizzle instance, so it queries as the restricted runtime role and needs
 * GRANTs on its own tables (see db/migrations, the rls_runtime_role migration).
 *
 * Its tables carry no merchantId and must never get an RLS policy: the session
 * lookup runs before any merchant context exists, so a policy there would lock
 * out login itself.
 *
 * Their schema is generated into src/database/schema/auth.ts by
 * `pnpm --filter api db:auth-schema` and flows through drizzle-kit like any
 * other table, so auth changes are versioned and reviewed rather than applied
 * out of band.
 */
export function createAuth(db: Database) {
  return betterAuth({
    database: drizzleAdapter(db, { provider: 'pg', schema }),
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
    databaseHooks: {
      user: {
        create: {
          // Every seller gets a shop the moment they have an account. This
          // fires on user *creation* only, so a Google sign-in that links to an
          // existing account under the trustedProviders rule above reuses that
          // seller's organization instead of opening a second one.
          after: async (createdUser) => {
            await ensureOrganizationForUser(db, createdUser);
          },
        },
      },
      session: {
        create: {
          // activeOrganizationId is what TenantGuard reads, and the plugin
          // declares it input: false, so a client cannot supply it - it has to
          // be resolved here or it stays null and every request is rejected.
          //
          // ensureOrganizationForUserId also repairs a seller whose signup hook
          // failed after their user row was committed: they get an
          // organization at next login rather than a permanent 403.
          before: async (session) => {
            const activeOrganizationId = await ensureOrganizationForUserId(db, session.userId);
            return { data: { ...session, activeOrganizationId } };
          },
        },
      },
    },
  });
}
