import { Module } from '@nestjs/common';
import { CategoriesRepository } from './categories.repository.js';
import { CategoriesService } from './categories.service.js';

/**
 * No controllers yet; the catalog API design adds them. CategoriesRepository
 * is exported because ProductsService must take the tree lock and check
 * liveness inside its own transaction, which a service call (opening its own
 * withMerchant) cannot do. DATABASE comes from the global DatabaseModule.
 */
@Module({
  providers: [CategoriesRepository, CategoriesService],
  exports: [CategoriesRepository, CategoriesService],
})
export class CategoriesModule {}
