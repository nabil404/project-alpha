import { Module } from '@nestjs/common';
import { CategoriesController } from './categories.controller';
import { CategoriesRepository } from './categories.repository';
import { CategoriesService } from './categories.service';

/**
 * Only the list route is exposed so far. CategoriesRepository is exported because ProductsService must take the tree lock and check
 * liveness inside its own transaction, which a service call (opening its own
 * withMerchant) cannot do. DATABASE comes from the global DatabaseModule.
 */
@Module({
  controllers: [CategoriesController],
  providers: [CategoriesRepository, CategoriesService],
  exports: [CategoriesRepository, CategoriesService],
})
export class CategoriesModule {}
