import { Module } from '@nestjs/common';
import { CategoriesModule } from '../categories/categories.module';
import { StorageModule } from '../storage/storage.module';
import { ProductImageRepository } from './images/product-image.repository';
import { ProductImagesController } from './images/product-images.controller';
import { ProductImagesService } from './images/product-images.service';
import { ProductOptionsRepository } from './options/product-options.repository';
import { ProductWriter } from './options/product-writer';
import { DeliveryChargesRepository } from '../settings/delivery-charges.repository';
import { ProductDeliveryRepository } from './product-delivery.repository';
import { ProductsController } from './products.controller';
import { ProductsRepository } from './products.repository';
import { ProductsService } from './products.service';

/**
 * Depends on categories, never the reverse. Products and their images are
 * separate controllers: the product document is saved as a whole, while the
 * gallery changes one photo at a time.
 */
@Module({
  imports: [CategoriesModule, StorageModule],
  controllers: [ProductsController, ProductImagesController],
  providers: [
    ProductsRepository,
    ProductsService,
    ProductImageRepository,
    ProductImagesService,
    ProductOptionsRepository,
    ProductWriter,
    ProductDeliveryRepository,
    // Stateless; read here to check a product's own charges name the shop's areas.
    DeliveryChargesRepository,
  ],
  exports: [ProductsService, ProductImagesService, ProductImageRepository],
})
export class ProductsModule {}
