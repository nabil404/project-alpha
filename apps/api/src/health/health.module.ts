import { Controller, Get, Inject, Module, VERSION_NEUTRAL } from '@nestjs/common';
import { HealthCheck, HealthCheckService, TerminusModule } from '@nestjs/terminus';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import { sql } from 'drizzle-orm';
import { DATABASE, type Database } from '../database/database.module.js';

// Probed by Uptime Kuma and the container healthcheck, neither of which signs in.
@AllowAnonymous()
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    @Inject(DATABASE) private readonly db: Database,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      async () => {
        await this.db.execute(sql`select 1`);
        return { database: { status: 'up' as const } };
      },
    ]);
  }
}

@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
})
export class HealthModule {}
