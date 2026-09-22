import { Global, Inject, Module } from '@nestjs/common';
import { DATABASE, type Database } from '../database/database.module.js';
import { createAuth } from './auth.config.js';

export const AUTH = Symbol('AUTH');
export type Auth = ReturnType<typeof createAuth>;

/**
 * Nothing mounts the Better Auth HTTP handler yet. When something does, note
 * that Better Auth writes its own { message, code } JSON straight to the
 * response and never passes through AllExceptionsFilter, so its errors will
 * need mapping onto the coded envelope — see the error-response contract in
 * .claude/skills/rest-api-design/references/response-formats.md.
 */
@Global()
@Module({
  providers: [
    {
      provide: AUTH,
      inject: [DATABASE],
      // Better Auth shares the API's Postgres pool.
      useFactory: (db: Database): Auth => createAuth(db),
    },
  ],
  exports: [AUTH],
})
export class AuthModule {
  constructor(@Inject(AUTH) readonly auth: Auth) {}
}
