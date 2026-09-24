import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { configureApp, NEST_APP_OPTIONS } from './bootstrap.js';
import { AppConfig } from './config/config.module.js';

async function bootstrap(): Promise<void> {
  // The Meta webhook HMAC is computed over the unparsed body; AuthModule
  // provides req.rawBody now that Nest's own parser is off (see bootstrap.ts).
  const app = await NestFactory.create(AppModule, NEST_APP_OPTIONS);

  const logger = app.get(Logger);
  app.useLogger(logger);
  configureApp(app, logger);
  app.enableShutdownHooks();

  const config = app.get(AppConfig);
  await app.listen(config.get('PORT'), '0.0.0.0');
}

void bootstrap();
