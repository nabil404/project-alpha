import { Module } from '@nestjs/common';
import { CategoriesModule } from '../categories/categories.module';
import { StorageModule } from '../storage/storage.module';
import { ProductImageRepository } from './images/product-image.repository';
import { ProductImagesController } from './images/product-images.controller';
import { ProductImagesService } from './images/product-images.service';
import { ProductOptionsRepository } from './options/product-options.repository';
import { ProductWriter } from './options/product-writer';
import { ProductsRepository } from './products.repository';
import { ProductsService } from './products.service';

/**
 * Depends on categories, never the reverse. The image routes are the first
 * controller; the catalog API design adds the product routes beside them.
 */
@Module({
  imports: [CategoriesModule, StorageModule],
  controllers: [ProductImagesController],
  providers: [
    ProductsRepository,
    ProductsService,
    ProductImageRepository,
    ProductImagesService,
    ProductOptionsRepository,
    ProductWriter,
  ],
  exports: [ProductsService, ProductImagesService, ProductImageRepository],
})
export class ProductsModule {}
