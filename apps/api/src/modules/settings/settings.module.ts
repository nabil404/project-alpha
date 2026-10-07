import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
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

/** Settings > General (profile, logo, region), Delivery charges and Notifications. */
@Module({
  imports: [StorageModule],
  controllers: [
    GeneralSettingsController,
    DeliverySettingsController,
    NotificationSettingsController,
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
  ],
  exports: [
    GeneralSettingsService,
    DeliveryChargesRepository,
    NotificationPreferencesRepository,
    ShopProfileRepository,
  ],
})
export class SettingsModule {}
