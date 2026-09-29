import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AppConfigModule } from '../config/config.module';
import { AppConfig } from '../config/app.config';
import { MESSENGER_QUEUE, PROFILE_QUEUE, STORAGE_QUEUE } from './queue.constants';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [AppConfigModule],
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        connection: { url: config.get('REDIS_URL') },
        defaultJobOptions: {
          attempts: 5,
          backoff: { type: 'exponential', delay: 1_000 },
          removeOnComplete: { age: 3_600, count: 1_000 },
          removeOnFail: { age: 24 * 3_600 },
        },
      }),
    }),
    BullModule.registerQueue(
      { name: MESSENGER_QUEUE },
      { name: STORAGE_QUEUE },
      { name: PROFILE_QUEUE },
    ),
  ],
  exports: [BullModule],
})
export class QueueModule {}
