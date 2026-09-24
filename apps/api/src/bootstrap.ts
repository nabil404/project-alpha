import type { INestApplication, LoggerService, NestApplicationOptions } from '@nestjs/common';
import { AllExceptionsFilter } from './common/errors/index.js';

/**
 * Options for NestFactory.create, shared by main.ts and the supertest runs.
 *
 * Nest's body parser is off because Better Auth has to read /api/auth request
 * bodies itself. AuthModule re-adds JSON and urlencoded parsing for every other
 * route, and attaches req.rawBody for the Messenger signature check - which is
 * why there is no `rawBody: true` here: with the parser off it does nothing.
 */
export const NEST_APP_OPTIONS = {
  bufferLogs: true,
  bodyParser: false,
} as const satisfies NestApplicationOptions;

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
