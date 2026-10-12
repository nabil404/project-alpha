import { Module } from '@nestjs/common';
import { CategoriesModule } from '../../src/modules/categories/categories.module';
import { AppConfigModule } from '../../src/modules/config/config.module';
import { DatabaseModule } from '../../src/modules/database/database.module';
import { ProductsModule } from '../../src/modules/products/products.module';
import { DeliveryChargesRepository } from '../../src/modules/settings/delivery-charges.repository';
import { ProductSeeder } from './product-seeder';

/** Only what the seed writes through: no HTTP, auth, queue or logger. */
@Module({
  imports: [AppConfigModule, DatabaseModule, CategoriesModule, ProductsModule],
  // Stateless, and the settings module does not export it.
  providers: [ProductSeeder, DeliveryChargesRepository],
})
export class SeedModule {}
