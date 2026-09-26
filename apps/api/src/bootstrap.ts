import {
  VersioningType,
  type INestApplication,
  type LoggerService,
  type NestApplicationOptions,
} from '@nestjs/common';
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
 * exercises the same routes and the same error envelope as production.
 *
 * Every controller lands at /api/v1/...; a breaking change adds a
 * @Version('2') handler to the affected route only, beside the v1 one.
 * /health opts out with VERSION_NEUTRAL. Better Auth is mounted at its own
 * literal basePath (auth.config.ts) and never passes through Nest routing.
 *
 * The logger is passed in rather than pulled from the container so this stays
 * independent of how it was provided. The worker boots through
 * createApplicationContext and has no HTTP server — it must not call this.
 */
export function configureApp(app: INestApplication, logger: LoggerService): void {
  app.setGlobalPrefix('api', { exclude: ['health'] });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalFilters(new AllExceptionsFilter(logger));
}
