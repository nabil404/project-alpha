import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { LoggerModule } from 'nestjs-pino';
import { AppConfig, AppConfigModule } from './config/config.module.js';
import { DatabaseModule } from './database/database.module.js';
import { AuthModule } from './auth/auth.module.js';
import { SessionGuard } from './auth/session.guard.js';
import { HealthModule } from './health/health.module.js';
import { QueueModule } from './modules/queue/queue.module.js';
import { MessengerModule } from './modules/messenger/messenger.module.js';
import { CryptoService } from './common/crypto.service.js';
import { redactUrl } from './common/redact-url.js';

@Module({
  imports: [
    AppConfigModule,
    LoggerModule.forRootAsync({
      imports: [AppConfigModule],
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        pinoHttp: {
          level: config.get('LOG_LEVEL'),
          transport: config.isProduction ? undefined : { target: 'pino-pretty' },
          // Secrets never reach the logs.
          redact: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.headers["x-hub-signature-256"]',
            // Better Auth's session cookie, on sign-in and every refresh.
            'res.headers["set-cookie"]',
            '*.accessToken',
            '*.pageAccessToken',
            '*.password',
            '*.newPassword',
            '*.token',
          ],
          // Email links and OAuth callbacks carry their credential in the URL.
          serializers: {
            req: (req: { url?: string }) => ({
              ...req,
              url: req.url === undefined ? undefined : redactUrl(req.url),
            }),
          },
        },
      }),
    }),
    ThrottlerModule.forRootAsync({
      imports: [AppConfigModule],
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        throttlers: [{ ttl: 60_000, limit: 120 }],
        storage: new ThrottlerStorageRedisService(config.get('REDIS_URL')),
      }),
    }),
    DatabaseModule,
    AuthModule,
    QueueModule,
    HealthModule,
    MessengerModule,
  ],
  providers: [
    CryptoService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Every route needs a session unless marked @AllowAnonymous().
    { provide: APP_GUARD, useClass: SessionGuard },
  ],
  exports: [CryptoService],
})
export class AppModule {}
