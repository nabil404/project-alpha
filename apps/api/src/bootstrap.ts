import type { INestApplication, LoggerService } from '@nestjs/common';
import { AllExceptionsFilter } from './common/errors/index.js';

/**
 * HTTP-layer wiring shared by main.ts and the supertest run, so a test
 * exercises the same route prefix and the same error envelope as production.
 *
 * The logger is passed in rather than pulled from the container so this stays
 * independent of how it was provided. The worker boots through
 * createApplicationContext and has no HTTP server — it must not call this.
 */
export function configureApp(app: INestApplication, logger: LoggerService): void {
  app.setGlobalPrefix('api', { exclude: ['health'] });
  app.useGlobalFilters(new AllExceptionsFilter(logger));
}
