import { Module } from '@nestjs/common';
import { LlmModule } from '../../llm/llm.module';
import { FacebookPageModule } from '../../messenger/page/facebook-page.module';
import { ProductPostsModule } from '../../messenger/posts/product-posts.module';
import { NotificationsModule } from '../../notifications/notifications.module';
import { OrdersModule } from '../../orders/orders.module';
import { ProductsModule } from '../../products/products.module';
import { DeliveryChargesRepository } from '../../settings/delivery-charges.repository';
import { QueueModule } from '../../queue/queue.module';
import { SettingsModule } from '../../settings/settings.module';
import { ConversationsModule } from '../conversations.module';
import { CustomerPhotosModule } from '../photos/customer-photos.module';
import { AssistantTurnProcessor } from './assistant-turn.processor';
import { AssistantTurnService } from './assistant-turn.service';
import { LlmCallRepository } from './llm-call.repository';
import { OrderConfirmationService } from './order-confirmation.service';

/** Worker-only: imported by WorkerModule, never by AppModule. */
@Module({
  imports: [
    QueueModule,
    LlmModule,
    FacebookPageModule,
    ProductPostsModule,
    ConversationsModule,
    CustomerPhotosModule,
    SettingsModule,
    NotificationsModule,
    ProductsModule,
    OrdersModule,
  ],
  providers: [
    DeliveryChargesRepository,
    LlmCallRepository,
    AssistantTurnService,
    OrderConfirmationService,
    AssistantTurnProcessor,
  ],
})
export class AssistantModule {}
