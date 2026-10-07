import { Module } from '@nestjs/common';
import { AppModule } from './app.module';
import { ConversationIngestModule } from './modules/conversations/ingest/conversation-ingest.module';
import { CustomerProfilesModule } from './modules/conversations/profiles/customer-profiles.module';
import { NotificationsWorkerModule } from './modules/notifications/notifications-worker.module';
import { StorageMaintenanceModule } from './modules/products/images/storage-maintenance.module';

/**
 * Everything the API has, plus the queue processors. The API boots AppModule
 * alone, so processors registered here never run in the HTTP process.
 */
@Module({
  imports: [
    AppModule,
    StorageMaintenanceModule,
    ConversationIngestModule,
    CustomerProfilesModule,
    NotificationsWorkerModule,
  ],
})
export class WorkerModule {}
