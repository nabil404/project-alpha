import { Logger } from '@nestjs/common';
import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware, isAPIError } from 'better-auth/api';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { organization } from 'better-auth/plugins';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@app/shared';
import type { AppConfig } from '../config/app.config.js';
import type { Database } from '../database/database.module.js';
import {
  ensureOrganizationForUser,
  ensureOrganizationForUserId,
} from '../database/ensure-organization.js';
import * as schema from '../database/schema/index.js';
import type { Mailer } from '../modules/mail/mail.service.js';
import {
  existingAccountEmail,
  resetPasswordEmail,
  verificationEmail,
} from '../modules/mail/templates.js';
import { toAuthErrorBody } from './auth-errors.js';

/** The settings createAuth reads, so nothing here touches process.env. */
export interface AuthSettings {
  /** The SPA's origin. Caddy serves /api on it too, so it is also Better Auth's baseURL. */
  appUrl: string;
  secret: string;
  google: { clientId: string; clientSecret: string };
  facebook: { clientId: string; clientSecret: string };
}

export function authSettingsFrom(config: AppConfig): AuthSettings {
  return {
    appUrl: config.get('APP_URL'),
    secret: config.get('BETTER_AUTH_SECRET'),
    google: {
      clientId: config.get('GOOGLE_CLIENT_ID') ?? '',
      clientSecret: config.get('GOOGLE_CLIENT_SECRET') ?? '',
    },
    facebook: {
      clientId: config.get('FACEBOOK_CLIENT_ID') ?? '',
      clientSecret: config.get('FACEBOOK_CLIENT_SECRET') ?? '',
    },
  };
}

export interface AuthDependencies {
  db: Database;
  settings: AuthSettings;
  mailer: Mailer;
}

/** Seconds. The reset link is the more dangerous one, so it lives shorter. */
export const VERIFICATION_TOKEN_TTL = 24 * 60 * 60;
export const RESET_PASSWORD_TOKEN_TTL = 60 * 60;

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
 *
 * The HTTP surface is mounted at /api/v1/auth by AuthModule (auth.module.ts).
 * The SPA drives the email flows with these callback paths:
 *   - sign-up sends `callbackURL: '/'`; the emailed link verifies, signs the
 *     seller in and redirects there, or to `/?error=INVALID_TOKEN|TOKEN_EXPIRED`;
 *   - forgot-password sends `redirectTo: '/reset-password'`; the emailed link
 *     lands on `/reset-password?token=...` (or `?error=INVALID_TOKEN`), and that
 *     page POSTs /api/v1/auth/reset-password with the token and new password.
 */
export function createAuth({ db, settings, mailer }: AuthDependencies) {
  const logger = new Logger('BetterAuth');

  return betterAuth({
    // Into pino with everything else, rather than straight to the console.
    // Nothing below warn: at info Better Auth logs the address behind a
    // duplicate sign-up, and emails don't belong in the logs.
    logger: {
      level: 'warn',
      log: (level, message) => {
        if (level === 'error') {
          logger.error(message);
        } else {
          logger.warn(message);
        }
      },
    },
    database: drizzleAdapter(db, { provider: 'pg', schema }),
    baseURL: settings.appUrl,
    // A literal, not derived from the API version: this is Better Auth's
    // contract, not ours, and it does not move with a future /api/v2.
    basePath: '/api/v1/auth',
    secret: settings.secret,
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
      resetPasswordTokenExpiresIn: RESET_PASSWORD_TOKEN_TTL,
      // A reset is how a seller takes back an account someone else got into,
      // so it signs every existing session out.
      revokeSessionsOnPasswordReset: true,
      // Mail is dispatched, not awaited: see Mailer.dispatch.
      sendResetPassword: async ({ user, url }) => {
        mailer.dispatch({ to: user.email, ...resetPasswordEmail(url) });
      },
      // With requireEmailVerification, signing up with a taken email answers
      // like a fresh sign-up so the form can't be used to probe for accounts.
      // The real owner hears about it here instead.
      onExistingUserSignUp: async ({ user }) => {
        mailer.dispatch({ to: user.email, ...existingAccountEmail(`${settings.appUrl}/sign-in`) });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      // An unverified seller who tries to sign in gets a fresh link rather
      // than a dead end.
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      expiresIn: VERIFICATION_TOKEN_TTL,
      sendVerificationEmail: async ({ user, url }) => {
        mailer.dispatch({ to: user.email, ...verificationEmail(url) });
      },
    },
    socialProviders: {
      google: {
        clientId: settings.google.clientId,
        clientSecret: settings.google.clientSecret,
        // Google guarantees a verified email, so it may link to an existing account.
        mapProfileToUser: (profile) => ({ email: profile.email }),
      },
      facebook: {
        clientId: settings.facebook.clientId,
        clientSecret: settings.facebook.clientSecret,
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
    hooks: {
      // Every error an auth endpoint returns leaves in the API's coded
      // envelope. Redirects are APIErrors too (302), so only real failures are
      // rewritten; the email links' redirects pass through untouched.
      after: createAuthMiddleware(async (ctx) => {
        const returned = ctx.context.returned;
        if (!isAPIError(returned) || returned.statusCode < 400 || isEnveloped(returned.body)) {
          return;
        }
        throw new APIError(
          returned.status,
          { error: toAuthErrorBody(returned, ctx.path) },
          returned.headers,
          returned.statusCode,
        );
      }),
    },
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

/** An endpoint calling another through the API would otherwise be wrapped twice. */
function isEnveloped(body: unknown): boolean {
  return typeof body === 'object' && body !== null && 'error' in body;
}
