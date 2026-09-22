import { Global, Module, type OnModuleDestroy } from '@nestjs/common';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { AppConfig } from '../config/app.config.js';
import * as schema from './schema/index.js';

export const DATABASE = Symbol('DATABASE');
export type Database = NodePgDatabase<typeof schema>;

@Global()
@Module({
  providers: [
    {
      provide: DATABASE,
      inject: [AppConfig],
      useFactory: (config: AppConfig): Database => {
        // DATABASE_URL is the restricted, non-superuser role, so row-level
        // security applies to it. Schema tooling uses DATABASE_ADMIN_URL and
        // never reaches this provider.
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

        return drizzle(pool, { schema });
      },
    },
  ],
  exports: [DATABASE],
})
export class DatabaseModule implements OnModuleDestroy {
  constructor() {}

  async onModuleDestroy(): Promise<void> {
    // Drizzle owns the pool; Nest disposes it through the provider's lifetime.
  }
}
