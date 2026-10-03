import { Logger } from '@nestjs/common';
import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware, getOAuthState, isAPIError } from 'better-auth/api';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { openAPI, organization } from 'better-auth/plugins';
import { eq } from 'drizzle-orm';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  RESET_PASSWORD_TOKEN_TTL,
  signUpSchema,
  updateProfileSchema,
} from '@app/shared';
import { zodIssuesToFields } from '../../common/errors/validation-fields';
import type { AppConfig } from '../config/app.config';
import type { Database } from '../database/database.module';
import {
  ensureOrganizationForUser,
  ensureOrganizationForUserId,
} from '../database/ensure-organization';
import * as schema from '../database/schema/index';
import type { Mailer } from '../mail/mail.service';
import { existingAccountEmail, resetPasswordEmail, verificationEmail } from '../mail/templates';
import { seedRegionFromPhone } from '../settings/region-from-phone';
import { toAuthErrorBody, toOAuthErrorLocation } from './auth-errors';

/** The settings createAuth reads, so nothing here touches process.env. */
export interface AuthSettings {
  /** The SPA's origin. Caddy serves /api on it too, so it is also Better Auth's baseURL. */
  appUrl: string;
  secret: string;
  google: { clientId: string; clientSecret: string };
  facebook: { clientId: string; clientSecret: string };
  /**
   * Better Auth's brute-force limits (3 sign-ins per 10s, 3 reset emails a
   * minute, per client IP). Off only under test, where every request shares
   * one address.
   */
  rateLimit: boolean;
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
    rateLimit: config.get('NODE_ENV') !== 'test',
  };
}

export interface AuthDependencies {
  db: Database;
  settings: AuthSettings;
  mailer: Mailer;
}

/**
 * Seconds. The reset link is the more dangerous one, so it lives shorter:
 * RESET_PASSWORD_TOKEN_TTL, in @app/shared because the SPA tells the seller
 * when it expires.
 */
export const VERIFICATION_TOKEN_TTL = 24 * 60 * 60;

/**
 * Sessions and users live in our own Postgres. Better Auth shares the API's
 * Drizzle instance, so it queries as the restricted runtime role and needs
 * GRANTs on its own tables (see db/migrations, the rls_runtime_role migration).
 *
 * Its tables carry no merchantId and must never get an RLS policy: the session
 * lookup runs before any merchant context exists, so a policy there would lock
 * out login itself.
 *
 * Their schema is generated into src/modules/database/schema/auth.ts by
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
    // Set explicitly: left alone, Better Auth enables it only when its own read
    // of process.env.NODE_ENV says production, so a deploy that forgot
    // NODE_ENV would take sign-in and password reset unthrottled.
    rateLimit: { enabled: settings.rateLimit },
    user: {
      additionalFields: {
        // Collected at email sign-up (signUpSchema makes it required there),
        // but nullable: a Google or Facebook sign-up has no phone to give.
        phone: { type: 'string', required: false, input: true },
        // The dashboard language this person picked; null follows the shop's
        // country. Set only through PATCH /account/preferences, never sign-up
        // or /update-user.
        locale: { type: 'string', required: false, input: false },
      },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
      resetPasswordTokenExpiresIn: RESET_PASSWORD_TOKEN_TTL,
      // A reset is how a seller takes back an account someone else got into,
      // so it signs every existing session out.
      revokeSessionsOnPasswordReset: true,
      // The emailed link proves the seller controls the mailbox. A seller who
      // came in through Facebook has an unverified email (see the facebook
      // mapProfileToUser below), and a reset is how they add a password: it
      // creates the credential account but never verifies the email, so with
      // requireEmailVerification their first password sign-in would be a 403.
      onPasswordReset: async ({ user }) => {
        if (!user.emailVerified) {
          await db
            .update(schema.user)
            .set({ emailVerified: true })
            .where(eq(schema.user.id, user.id));
        }
      },
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
        // Graph's /me has no email_verified, so Better Auth reads every Facebook
        // email as unverified - and its link callback refuses an unverified
        // email from an untrusted provider, which would make linking from
        // account settings impossible. `link` is set server-side, from the
        // session, only by /link-social: there the seller is signed in to both
        // accounts, and Better Auth still requires the emails to match. A plain
        // Facebook sign-in has no `link`, so it still never auto-links.
        mapProfileToUser: async () =>
          (await getOAuthState())?.link ? { emailVerified: true } : {},
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
    // openAPI() supplies auth.api.generateOpenAPISchema(), which setupOpenApi
    // (src/openapi/openapi.ts) merges into our own document in development.
    // Its HTTP surface stays shut in every environment: the Scalar page is
    // off, and the schema endpoint is disabled below - disabledPaths is
    // enforced by the router only, so the in-process call still works.
    // Organization deletion is off: every catalog table references
    // organization(id) with ON DELETE NO ACTION, so the delete would fail on
    // the first seller with products. It comes back with account deletion,
    // which must also delete every product image object under m/{merchantId}/
    // and every avatar under u/{userId}/avatar/ (outside the product sweep's prefix).
    plugins: [
      organization({ disableOrganizationDeletion: true }),
      openAPI({ disableDefaultReference: true }),
    ],
    disabledPaths: ['/open-api/generate-schema'],
    hooks: {
      // Email sign-up and profile updates are validated against the same
      // shared schemas as the SPA's forms, before Better Auth reads the body:
      // Better Auth checks only the fields it knows, and would store a blank
      // phone, drop a shop name, or take a blank name.
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === UPDATE_USER_PATH) {
          return { context: { body: validatedProfileUpdate(ctx.body) } };
        }
        if (ctx.path !== SIGN_UP_EMAIL_PATH) {
          return;
        }
        refuseImage(ctx.body);
        const parsed = signUpSchema.safeParse(ctx.body);
        if (!parsed.success) {
          throw validationFailed(zodIssuesToFields(parsed.error.issues));
        }
        // Merged over the body, so callbackURL and rememberMe pass through
        // and the trimmed values are what gets stored.
        return { context: { body: { ...ctx.body, ...parsed.data } } };
      }),
      // Every error an auth endpoint returns leaves in the API's coded
      // envelope. Redirects are APIErrors too (302), so only real failures are
      // rewritten; the email links' redirects pass through untouched.
      after: createAuthMiddleware(async (ctx) => {
        const returned = ctx.context.returned;
        // A failed Google/Facebook round trip redirects rather than answering
        // with an error body; its ?error= gets the same coded treatment.
        if (ctx.path.startsWith(OAUTH_CALLBACK_PATH) && isAPIError(returned)) {
          const location = returned.headers?.get('location');
          const rewritten = location ? toOAuthErrorLocation(location) : undefined;
          if (rewritten) {
            const headers = new Headers(returned.headers);
            headers.set('location', rewritten);
            throw new APIError(returned.status, returned.body, headers, returned.statusCode);
          }
          return;
        }
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
          //
          // An email sign-up names the shop; a social one has no shop name
          // to give, so its organization starts out under the seller's name.
          //
          // The sign-up phone's country also sets the shop's region, so a
          // seller outside Bangladesh doesn't start in taka and Dhaka time.
          // That is a convenience, not part of having an account: if it
          // fails, the shop keeps the default region and sign-up succeeds.
          after: async (createdUser, ctx) => {
            const merchantId = await ensureOrganizationForUser(db, createdUser, shopNameFrom(ctx));
            const { phone } = createdUser as { phone?: string | null };
            try {
              await seedRegionFromPhone(db, merchantId, phone);
            } catch (error) {
              logger.warn(
                `Could not set the region of shop ${merchantId} from its sign-up phone: ${String(error)}`,
              );
            }
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

const SIGN_UP_EMAIL_PATH = '/sign-up/email';
const UPDATE_USER_PATH = '/update-user';

function validationFailed(fields: ReturnType<typeof zodIssuesToFields>): APIError {
  return new APIError('BAD_REQUEST', {
    error: { code: 'VALIDATION_FAILED', message: 'Validation failed', params: {}, fields },
  });
}

/**
 * /update-user takes the name only. Better Auth merges whatever this hook
 * returns over the original body, so an extra field cannot be dropped here,
 * only refused: phone is an additional field with `input: true`, and would
 * otherwise be stored unchecked.
 */
function validatedProfileUpdate(body: unknown): Record<string, unknown> {
  refuseImage(body);
  const input = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const extra = Object.keys(input).filter((key) => key !== 'name');
  if (extra.length > 0) {
    throw validationFailed(
      Object.fromEntries(
        extra.map((key) => [
          key,
          [{ code: 'UNRECOGNIZED_KEYS', message: 'Not accepted here', params: {} }],
        ]),
      ),
    );
  }
  const parsed = updateProfileSchema.safeParse(input);
  if (!parsed.success) {
    throw validationFailed(zodIssuesToFields(parsed.error.issues));
  }
  return parsed.data;
}

/**
 * The photo is set through /account/avatar, which strips its metadata and
 * stores it in our bucket. Neither sign-up nor /update-user may take an
 * `image`, so a client can never point it at a URL of its choosing.
 */
function refuseImage(body: unknown): void {
  if (typeof body === 'object' && body !== null && 'image' in body) {
    throw validationFailed({
      image: [
        {
          code: 'UNRECOGNIZED_KEYS',
          message: 'Set the photo through /account/avatar',
          params: {},
        },
      ],
    });
  }
}

/** Where Google and Facebook send the browser back to: `/callback/:id`. */
const OAUTH_CALLBACK_PATH = '/callback/';

/**
 * The shop name from an email sign-up's body, which the before hook has
 * already validated. Read on that path only: no other endpoint that creates a
 * user validates a shopName, so one sent there is ignored.
 */
function shopNameFrom(ctx: { path?: string; body?: unknown } | null): string | undefined {
  if (ctx?.path !== SIGN_UP_EMAIL_PATH) {
    return undefined;
  }
  const parsed = signUpSchema.shape.shopName.safeParse(
    (ctx.body as { shopName?: unknown } | undefined)?.shopName,
  );
  return parsed.success ? parsed.data : undefined;
}

/** An endpoint calling another through the API would otherwise be wrapped twice. */
function isEnveloped(body: unknown): boolean {
  return typeof body === 'object' && body !== null && 'error' in body;
}
