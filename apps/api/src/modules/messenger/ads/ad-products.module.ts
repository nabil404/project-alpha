import { Module } from '@nestjs/common';
import { ProductsRepository } from '../../products/products.repository';
import { AdProductRepository } from './ad-product.repository';
import { AdProductsController } from './ad-products.controller';
import { AdProductsService } from './ad-products.service';

/** The repository is exported for the worker's inbound-message ingest. */
@Module({
  controllers: [AdProductsController],
  // Stateless; read here to check the product a seller maps exists in the shop.
  providers: [AdProductRepository, AdProductsService, ProductsRepository],
  exports: [AdProductRepository],
})
export class AdProductsModule {}
