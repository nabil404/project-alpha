import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AppConfig } from '../config/app.config';
import {
  ASSISTANT_QUEUE,
  CUSTOMER_PHOTO_QUEUE,
  IMPORTS_QUEUE,
  MESSENGER_PROFILE_QUEUE,
  MESSENGER_QUEUE,
  NOTIFICATIONS_QUEUE,
  PROFILE_QUEUE,
  STORAGE_QUEUE,
} from './queue.constants';

@Module({
  imports: [
    // AppConfig comes from the global AppConfigModule that AppModule imports.
    // Importing it here would validate the environment as soon as a spec
    // loaded this file, even one that swaps in FakeQueueModule.
    BullModule.forRootAsync({
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
      { name: NOTIFICATIONS_QUEUE },
      { name: ASSISTANT_QUEUE },
      { name: MESSENGER_PROFILE_QUEUE },
      { name: CUSTOMER_PHOTO_QUEUE },
      { name: IMPORTS_QUEUE },
    ),
  ],
  exports: [BullModule],
})
export class QueueModule {}
