import { Module } from '@nestjs/common';
import { QueueModule } from '../../queue/queue.module';
import { StorageModule } from '../../storage/storage.module';
import { ConversationsModule } from '../conversations.module';
import { CustomerPhotoProcessor } from './customer-photo.processor';
import { CustomerPhotoStore, PHOTO_DOWNLOADER, type PhotoDownloader } from './customer-photo.store';
import { downloadPhoto } from './photo-download';

/** Worker-only: imported by WorkerModule and AssistantModule, never by AppModule. */
@Module({
  imports: [QueueModule, StorageModule, ConversationsModule],
  providers: [
    {
      provide: PHOTO_DOWNLOADER,
      useValue: ((url) => downloadPhoto(url)) satisfies PhotoDownloader,
    },
    CustomerPhotoStore,
    CustomerPhotoProcessor,
  ],
  exports: [CustomerPhotoStore],
})
export class CustomerPhotosModule {}
