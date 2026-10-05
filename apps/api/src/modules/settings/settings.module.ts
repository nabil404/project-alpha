import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { DeliveryChargesRepository } from './delivery-charges.repository';
import { DeliverySettingsController } from './delivery-settings.controller';
import { DeliverySettingsService } from './delivery-settings.service';
import { GeneralSettingsController } from './general-settings.controller';
import { GeneralSettingsService } from './general-settings.service';
import { ShopLogoService } from './logo/shop-logo.service';
import { MerchantSettingsRepository } from './merchant-settings.repository';
import { ShopProfileRepository } from './shop-profile.repository';

/** Settings > General (profile, logo, region) and Settings > Delivery charges. */
@Module({
  imports: [StorageModule],
  controllers: [GeneralSettingsController, DeliverySettingsController],
  providers: [
    MerchantSettingsRepository,
    ShopProfileRepository,
    GeneralSettingsService,
    ShopLogoService,
    DeliveryChargesRepository,
    DeliverySettingsService,
  ],
  exports: [GeneralSettingsService, DeliveryChargesRepository],
})
export class SettingsModule {}
