import { Module } from '@nestjs/common';
import { FacebookPageModule } from '../messenger/page/facebook-page.module';
import { StorageModule } from '../storage/storage.module';
import { AssistantSettingsController } from './assistant-settings.controller';
import { AssistantSettingsRepository } from './assistant-settings.repository';
import { AssistantSettingsService } from './assistant-settings.service';
import { DeliveryChargesRepository } from './delivery-charges.repository';
import { DeliverySettingsController } from './delivery-settings.controller';
import { DeliverySettingsService } from './delivery-settings.service';
import { GeneralSettingsController } from './general-settings.controller';
import { GeneralSettingsService } from './general-settings.service';
import { ShopLogoService } from './logo/shop-logo.service';
import { MerchantSettingsRepository } from './merchant-settings.repository';
import { NotificationPreferencesRepository } from './notification-preferences.repository';
import { NotificationSettingsController } from './notification-settings.controller';
import { NotificationSettingsService } from './notification-settings.service';
import { ShopProfileRepository } from './shop-profile.repository';

/** Settings > General (profile, logo, region), Delivery charges, Notifications and Order assistant. */
@Module({
  imports: [StorageModule, FacebookPageModule],
  controllers: [
    GeneralSettingsController,
    DeliverySettingsController,
    NotificationSettingsController,
    AssistantSettingsController,
  ],
  providers: [
    MerchantSettingsRepository,
    ShopProfileRepository,
    GeneralSettingsService,
    ShopLogoService,
    DeliveryChargesRepository,
    DeliverySettingsService,
    NotificationPreferencesRepository,
    NotificationSettingsService,
    AssistantSettingsRepository,
    AssistantSettingsService,
  ],
  exports: [
    MerchantSettingsRepository,
    GeneralSettingsService,
    DeliveryChargesRepository,
    NotificationPreferencesRepository,
    ShopProfileRepository,
    AssistantSettingsService,
  ],
})
export class SettingsModule {}
