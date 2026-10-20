import { Module } from '@nestjs/common';
import { CryptoService } from '../../common/crypto.service';
import { FacebookPageModule } from '../messenger/page/facebook-page.module';
import { ProductsModule } from '../products/products.module';
import { QueueModule } from '../queue/queue.module';
import { MerchantSettingsRepository } from '../settings/merchant-settings.repository';
import { StorageModule } from '../storage/storage.module';
import { ImportRepository } from './import.repository';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';

/**
 * Catalog > Import from Facebook posts: the routes, live in the API and the
 * worker alike. The run itself is ImportsWorkerModule's.
 */
@Module({
  imports: [QueueModule, StorageModule, FacebookPageModule, ProductsModule],
  controllers: [ImportsController],
  providers: [
    CryptoService,
    // Stateless; read here for the shop's time zone.
    MerchantSettingsRepository,
    ImportRepository,
    ImportsService,
  ],
  exports: [ImportRepository],
})
export class ImportsModule {}
