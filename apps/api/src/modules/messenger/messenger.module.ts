import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MESSENGER_QUEUE } from '../queue/queue.constants';
import { MessengerController } from './messenger.controller';
import { FacebookPageModule } from './page/facebook-page.module';

@Module({
  imports: [BullModule.registerQueue({ name: MESSENGER_QUEUE }), FacebookPageModule],
  controllers: [MessengerController],
})
export class MessengerModule {}
