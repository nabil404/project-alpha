import { Module } from '@nestjs/common';
import { CryptoService } from '../../../common/crypto.service';
import { FacebookPageModule } from '../../messenger/page/facebook-page.module';
import { QueueModule } from '../../queue/queue.module';
import { ConversationsModule } from '../conversations.module';
import { CustomerProfileRefresh } from './customer-profile-refresh';
import { CustomerProfileReader } from './customer-profile.reader';
import { ProfileRefreshProcessor } from './profile-refresh.processor';

/**
 * Worker-only: imported by WorkerModule and ConversationIngestModule, never by
 * AppModule. Exports the reader the ingest uses for a new customer's profile.
 */
@Module({
  imports: [QueueModule, FacebookPageModule, ConversationsModule],
  providers: [
    CryptoService,
    CustomerProfileReader,
    CustomerProfileRefresh,
    ProfileRefreshProcessor,
  ],
  exports: [CustomerProfileReader],
})
export class CustomerProfilesModule {}
