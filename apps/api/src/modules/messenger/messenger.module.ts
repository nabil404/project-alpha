import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MESSENGER_QUEUE } from '../queue/queue.constants';
import { MessengerController } from './messenger.controller';

@Module({
  imports: [BullModule.registerQueue({ name: MESSENGER_QUEUE })],
  controllers: [MessengerController],
})
export class MessengerModule {}
