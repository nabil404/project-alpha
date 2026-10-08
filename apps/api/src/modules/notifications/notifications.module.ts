import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { NotificationsService } from './notifications.service';

/**
 * Seller notification emails: the producer half, live in the API and the
 * worker alike. The processor is NotificationsWorkerModule's.
 */
@Module({
  imports: [QueueModule],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
