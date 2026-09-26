import { Controller, Get, Inject, Module, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags, type SchemaObject } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService, TerminusModule } from '@nestjs/terminus';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import { sql } from 'drizzle-orm';
import { DATABASE, type Database } from '../database/database.module.js';
import { ApiCodedError } from '../openapi/api-coded-error.js';

const indicators: SchemaObject = {
  type: 'object',
  additionalProperties: {
    type: 'object',
    properties: { status: { type: 'string', enum: ['up', 'down'] } },
    required: ['status'],
  },
};

// Probed by Uptime Kuma and the container healthcheck, neither of which signs in.
@AllowAnonymous()
@ApiTags('Health')
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    @Inject(DATABASE) private readonly db: Database,
  ) {}

  @Get()
  @HealthCheck()
  @ApiOperation({ summary: 'Liveness and database connectivity', security: [] })
  @ApiOkResponse({
    description: 'Every indicator is up.',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['ok'] },
        info: indicators,
        error: indicators,
        details: indicators,
      },
      required: ['status', 'info', 'error', 'details'],
    },
  })
  // Terminus throws an uncoded ServiceUnavailableException, which the filter
  // turns into HTTP_503; which indicator failed is not in the body.
  @ApiCodedError(503, ['HTTP_503'])
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
