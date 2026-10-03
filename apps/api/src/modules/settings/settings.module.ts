import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { GeneralSettingsController } from './general-settings.controller';
import { GeneralSettingsService } from './general-settings.service';
import { ShopLogoService } from './logo/shop-logo.service';
import { MerchantSettingsRepository } from './merchant-settings.repository';
import { ShopProfileRepository } from './shop-profile.repository';

/** Settings > General: the shop's profile, logo and region. */
@Module({
  imports: [StorageModule],
  controllers: [GeneralSettingsController],
  providers: [
    MerchantSettingsRepository,
    ShopProfileRepository,
    GeneralSettingsService,
    ShopLogoService,
  ],
  exports: [GeneralSettingsService],
})
export class SettingsModule {}
