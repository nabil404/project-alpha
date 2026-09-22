import { Global, Module, type OnModuleDestroy } from '@nestjs/common';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { AppConfig } from '../config/app.config.js';
import type { DB } from './database.types.js';

export const DATABASE = Symbol('DATABASE');
export type Database = Kysely<DB>;

@Global()
@Module({
  providers: [
    {
      provide: DATABASE,
      inject: [AppConfig],
      useFactory: (config: AppConfig): Database => {
        const pool = new Pool({
          connectionString: config.get('DATABASE_URL'),
          max: config.get('DATABASE_POOL_MAX'),
          // Timeouts are set per connection so a stuck statement can never hold
          // a conversation row lock for longer than the queue's retry window.
          options: [
            `-c lock_timeout=${config.get('DATABASE_LOCK_TIMEOUT_MS')}`,
            `-c idle_in_transaction_session_timeout=${config.get('DATABASE_IDLE_TX_TIMEOUT_MS')}`,
          ].join(' '),
        });

        return new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
      },
    },
  ],
  exports: [DATABASE],
})
export class DatabaseModule implements OnModuleDestroy {
  constructor() {}

  async onModuleDestroy(): Promise<void> {
    // Kysely owns the pool; Nest disposes it through the provider's lifetime.
  }
}
