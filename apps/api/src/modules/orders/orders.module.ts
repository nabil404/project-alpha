import { Module } from '@nestjs/common';
import { ProductDeliveryRepository } from '../products/product-delivery.repository';
import { DeliveryChargesRepository } from '../settings/delivery-charges.repository';
import { MerchantSettingsRepository } from '../settings/merchant-settings.repository';
import { DeliveryQuoteService } from './delivery-quote.service';
import { OrderCatalogRepository } from './order-catalog.repository';
import { OrderEventsRepository } from './order-events.repository';
import { OrdersController } from './orders.controller';
import { OrdersRepository } from './orders.repository';
import { OrdersService } from './orders.service';

/**
 * The seller-facing Orders API: the list and its stats, an order's detail and
 * activity, status changes with their stock moves, edits, and orders added by
 * hand. Orders the assistant drafts are written by the conversation flow.
 */
@Module({
  controllers: [OrdersController],
  providers: [
    OrdersRepository,
    OrderEventsRepository,
    OrderCatalogRepository,
    // Stateless; read here for the shop's currency and its row lock.
    MerchantSettingsRepository,
    // Stateless; read here to price delivery by area and products.
    DeliveryChargesRepository,
    ProductDeliveryRepository,
    OrdersService,
    DeliveryQuoteService,
  ],
})
export class OrdersModule {}
