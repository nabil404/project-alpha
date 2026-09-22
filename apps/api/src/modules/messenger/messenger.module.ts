import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MESSENGER_QUEUE } from '../queue/queue.constants.js';
import { MessengerController } from './messenger.controller.js';

@Module({
  imports: [BullModule.registerQueue({ name: MESSENGER_QUEUE })],
  controllers: [MessengerController],
})
export class MessengerModule {}
