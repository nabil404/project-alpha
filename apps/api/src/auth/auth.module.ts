import { Global, Inject, Module } from '@nestjs/common';
import { DATABASE, type Database } from '../database/database.module.js';
import { createAuth } from './auth.config.js';

export const AUTH = Symbol('AUTH');
export type Auth = ReturnType<typeof createAuth>;

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
