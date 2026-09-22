import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule, ConfigService } from '@nestjs/config';
import { validateEnv, type Env } from './env.schema.js';
import { AppConfig } from './app.config.js';

export { AppConfig } from './app.config.js';

@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
  ],
  providers: [
    {
      provide: AppConfig,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => new AppConfig(config),
    },
  ],
  exports: [AppConfig],
})
export class AppConfigModule {}
