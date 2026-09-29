import { Module } from '@nestjs/common';
import { AppModule } from './app.module';
import { ConversationIngestModule } from './modules/conversations/ingest/conversation-ingest.module';
import { StorageMaintenanceModule } from './modules/products/images/storage-maintenance.module';

/**
 * Everything the API has, plus the queue processors. The API boots AppModule
 * alone, so processors registered here never run in the HTTP process.
 */
@Module({
  imports: [AppModule, StorageMaintenanceModule, ConversationIngestModule],
})
export class WorkerModule {}
