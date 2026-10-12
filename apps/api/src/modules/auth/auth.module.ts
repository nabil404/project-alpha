import { AuthModule as BetterAuthModule } from '@thallesp/nestjs-better-auth';
import { AppConfig } from '../config/app.config';
import { DATABASE, type Database } from '../database/database.module';
import { MailModule } from '../mail/mail.module';
import { MailService } from '../mail/mail.service';
import { authSettingsFrom, createAuth } from './auth.config';

export type Auth = ReturnType<typeof createAuth>;

/**
 * Mounts Better Auth at /api/v1/auth through @thallesp/nestjs-better-auth.
 *
 * - Nest's body parser is off (NEST_APP_OPTIONS in bootstrap.ts) because Better
 *   Auth reads the raw request. This module re-adds JSON and urlencoded parsing
 *   for other routes, and `bodyParser.rawBody` keeps req.rawBody for the
 *   Messenger signature check.
 * - SessionGuard replaces the module's global guard (see app.module.ts).
 * - Better Auth's errors bypass AllExceptionsFilter. The after-hook in
 *   auth.config.ts maps them to the coded envelope.
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
