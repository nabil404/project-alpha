import { Module } from '@nestjs/common';
import { CryptoService } from '../../../common/crypto.service';
import { ProductsRepository } from '../../products/products.repository';
import { FacebookPageModule } from '../page/facebook-page.module';
import { PagePostsController, ProductPostsController } from './product-posts.controller';
import { ProductPostsService } from './product-posts.service';
import { ProductPostRepository } from './product-post.repository';
import { POST_LINK_FETCH, SharedPostResolver } from './shared-post.resolver';

/** The resolver is exported for the assistant's turn. */
@Module({
  imports: [FacebookPageModule],
  controllers: [ProductPostsController, PagePostsController],
  providers: [
    CryptoService,
    // Stateless; read here to check the product a seller links exists in the shop.
    ProductsRepository,
    ProductPostRepository,
    ProductPostsService,
    SharedPostResolver,
    { provide: POST_LINK_FETCH, useValue: fetch },
  ],
  exports: [ProductPostRepository, SharedPostResolver],
})
export class ProductPostsModule {}
