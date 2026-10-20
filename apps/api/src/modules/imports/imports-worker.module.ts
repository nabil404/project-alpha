import { Module } from '@nestjs/common';
import { CryptoService } from '../../common/crypto.service';
import { CategoriesModule } from '../categories/categories.module';
import { LlmCallRepository } from '../conversations/assistant/llm-call.repository';
import type { PhotoDownloader } from '../conversations/photos/customer-photo.store';
import { downloadPhoto } from '../conversations/photos/photo-download';
import { LlmModule } from '../llm/llm.module';
import { FacebookPageModule } from '../messenger/page/facebook-page.module';
import { ProductPostsModule } from '../messenger/posts/product-posts.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ProductsModule } from '../products/products.module';
import { QueueModule } from '../queue/queue.module';
import { MerchantSettingsRepository } from '../settings/merchant-settings.repository';
import { StorageModule } from '../storage/storage.module';
import { IMPORT_PHOTO_DOWNLOADER, ImportPhotos } from './import-photos';
import { ImportRunner } from './import-runner';
import { ImportsModule } from './imports.module';
import { ImportsProcessor } from './imports.processor';

/** Worker-only: imported by WorkerModule, never by AppModule. */
@Module({
  imports: [
    QueueModule,
    StorageModule,
    LlmModule,
    FacebookPageModule,
    ProductPostsModule,
    ProductsModule,
    CategoriesModule,
    NotificationsModule,
    ImportsModule,
  ],
  providers: [
    CryptoService,
    MerchantSettingsRepository,
    LlmCallRepository,
    {
      provide: IMPORT_PHOTO_DOWNLOADER,
      useValue: ((url) => downloadPhoto(url)) satisfies PhotoDownloader,
    },
    ImportPhotos,
    ImportRunner,
    ImportsProcessor,
  ],
})
export class ImportsWorkerModule {}
