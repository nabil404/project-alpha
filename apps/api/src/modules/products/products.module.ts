import { Module } from '@nestjs/common';
import { CategoriesModule } from '../categories/categories.module.js';
import { ProductsRepository } from './products.repository.js';
import { ProductsService } from './products.service.js';

/** Depends on categories, never the reverse. No controllers yet; the catalog API design adds them. */
@Module({
  imports: [CategoriesModule],
  providers: [ProductsRepository, ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}
