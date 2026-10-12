import {
  VersioningType,
  type INestApplication,
  type LoggerService,
  type NestApplicationOptions,
} from '@nestjs/common';
import type { Express as ExpressApp } from 'express';
import { AllExceptionsFilter } from './common/errors/index';

/**
 * NestFactory.create options, shared by main.ts and the supertest runs. The
 * body parser is off because Better Auth reads /api/v1/auth bodies itself.
 * AuthModule re-adds parsing and req.rawBody for other routes, so
 * `rawBody: true` here would do nothing.
 */
export const NEST_APP_OPTIONS = {
  bufferLogs: true,
  bodyParser: false,
} as const satisfies NestApplicationOptions;

/**
 * HTTP wiring shared by main.ts and the supertest run, so tests hit the same
 * routes and error envelope as production. The worker has no HTTP server and
 * must not call this.
 *
 * Controllers live at /api/v1/...; a breaking change adds a @Version('2')
 * handler beside the v1 one. /health is VERSION_NEUTRAL, and Better Auth
 * mounts at its own basePath outside Nest routing.
 */
export function configureApp(app: INestApplication, logger: LoggerService): void {
  const express = app.getHttpAdapter().getInstance() as ExpressApp;
  // Caddy is the API's only client, since compose publishes no api port, so
  // without this req.ip is Caddy's address for every request and the throttler
  // puts every seller, and Meta, in one bucket. One hop: Caddy replaces any
  // X-Forwarded-For it did not add itself, so the last entry is the client.
  express.set('trust proxy', 1);
  express.disable('x-powered-by');

  app.setGlobalPrefix('api', { exclude: ['health'] });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalFilters(new AllExceptionsFilter(logger));
}
