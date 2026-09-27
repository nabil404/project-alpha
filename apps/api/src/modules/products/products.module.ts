import { Module } from '@nestjs/common';
import { CategoriesModule } from '../categories/categories.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { ProductImageRepository } from './images/product-image.repository.js';
import { ProductImagesController } from './images/product-images.controller.js';
import { ProductImagesService } from './images/product-images.service.js';
import { ProductsRepository } from './products.repository.js';
import { ProductsService } from './products.service.js';

/**
 * Depends on categories, never the reverse. The image routes are the first
 * controller; the catalog API design adds the product routes beside them.
 */
@Module({
  imports: [CategoriesModule, StorageModule],
  controllers: [ProductImagesController],
  providers: [ProductsRepository, ProductsService, ProductImageRepository, ProductImagesService],
  exports: [ProductsService, ProductImagesService, ProductImageRepository],
})
export class ProductsModule {}
