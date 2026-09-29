import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AuthService } from '@thallesp/nestjs-better-auth';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { configureApp, NEST_APP_OPTIONS } from './bootstrap';
import type { Auth } from './modules/auth/auth.module';
import { AppConfig } from './modules/config/config.module';
import { setupOpenApi } from './openapi/openapi';

async function bootstrap(): Promise<void> {
  // The Meta webhook HMAC is computed over the unparsed body; AuthModule
  // provides req.rawBody now that Nest's own parser is off (see bootstrap.ts).
  const app = await NestFactory.create(AppModule, NEST_APP_OPTIONS);

  const logger = app.get(Logger);
  app.useLogger(logger);
  configureApp(app, logger);
  app.enableShutdownHooks();

  const config = app.get(AppConfig);
  // A map of the whole auth surface is a development aid, not something to
  // hand to anyone who asks. Opt-in by name, so a deploy that forgot NODE_ENV,
  // or runs as staging or test, does not publish it.
  if (config.get('NODE_ENV') === 'development') {
    await setupOpenApi(app, app.get<AuthService<Auth>>(AuthService).instance);
  }

  await app.listen(config.get('PORT'), '0.0.0.0');
}

void bootstrap();
