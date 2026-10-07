import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
import { QueueModule } from '../queue/queue.module';
import { SettingsModule } from '../settings/settings.module';
import { NotificationComposer } from './notification-composer';
import { NotificationReadsRepository } from './notification-reads.repository';
import { NotificationsProcessor } from './notifications.processor';

/** Worker-only: imported by WorkerModule, never by AppModule. */
@Module({
  imports: [QueueModule, MailModule, SettingsModule],
  providers: [NotificationReadsRepository, NotificationComposer, NotificationsProcessor],
})
export class NotificationsWorkerModule {}
