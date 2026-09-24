import { AuthModule as BetterAuthModule } from '@thallesp/nestjs-better-auth';
import { AppConfig } from '../config/app.config.js';
import { DATABASE, type Database } from '../database/database.module.js';
import { MailModule } from '../modules/mail/mail.module.js';
import { MailService } from '../modules/mail/mail.service.js';
import { authSettingsFrom, createAuth } from './auth.config.js';

export type Auth = ReturnType<typeof createAuth>;

/**
 * Mounts Better Auth at /api/auth through @thallesp/nestjs-better-auth, which
 * also provides AuthService, the @Session() and @AllowAnonymous() decorators,
 * and the AuthGuard that SessionGuard extends.
 *
 * Two things this changes app-wide:
 *   - Nest's own body parser is off (NEST_APP_OPTIONS in bootstrap.ts): Better
 *     Auth reads the raw request itself, and the module re-adds JSON and
 *     urlencoded parsing for every other route. `bodyParser.rawBody` below is
 *     what keeps req.rawBody - and so the Messenger webhook signature check -
 *     working; `rawBody: true` on NestFactory no longer has any effect.
 *   - The module's global guard is replaced by SessionGuard (see app.module.ts),
 *     so every route needs a session unless it is marked @AllowAnonymous().
 *
 * Better Auth's error responses bypass AllExceptionsFilter; the after-hook in
 * auth.config.ts maps them onto the coded envelope instead.
 */
export const AuthModule = BetterAuthModule.forRootAsync({
  imports: [MailModule],
  inject: [DATABASE, AppConfig, MailService],
  useFactory: (db: Database, config: AppConfig, mailer: MailService) => ({
    // Better Auth shares the API's Postgres pool.
    auth: createAuth({ db, settings: authSettingsFrom(config), mailer }),
    bodyParser: { rawBody: true },
  }),
  disableGlobalAuthGuard: true,
});
