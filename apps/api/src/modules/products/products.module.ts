import { Module } from '@nestjs/common';
import { CategoriesModule } from '../categories/categories.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { ProductImageRepository } from './images/product-image.repository.js';
import { ProductImagesService } from './images/product-images.service.js';
import { ProductsRepository } from './products.repository.js';
import { ProductsService } from './products.service.js';

/** Depends on categories, never the reverse. No controllers yet; the catalog API design adds them. */
@Module({
  imports: [CategoriesModule, StorageModule],
  providers: [ProductsRepository, ProductsService, ProductImageRepository, ProductImagesService],
  exports: [ProductsService, ProductImagesService],
})
export class ProductsModule {}
