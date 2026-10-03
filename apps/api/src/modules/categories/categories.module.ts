import { Module } from '@nestjs/common';
import { CategoriesController } from './categories.controller';
import { CategoriesRepository } from './categories.repository';
import { CategoriesService } from './categories.service';

/**
 * CategoriesRepository is exported because ProductsService must take the category lock and check
 * liveness inside its own transaction, which a service call (opening its own
 * withMerchant) cannot do. DATABASE comes from the global DatabaseModule.
 */
@Module({
  controllers: [CategoriesController],
  providers: [CategoriesRepository, CategoriesService],
  exports: [CategoriesRepository, CategoriesService],
})
export class CategoriesModule {}
