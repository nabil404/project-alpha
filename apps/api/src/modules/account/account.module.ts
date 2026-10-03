import { Module } from '@nestjs/common';
import { AuthService } from '@thallesp/nestjs-better-auth';
import type { Auth } from '../auth/auth.module';
import { StorageModule } from '../storage/storage.module';
import { AccountController } from './account.controller';
import { AvatarService } from './avatar/avatar.service';
import { UserImageRepository } from './avatar/user-image.repository';
import { UserPreferencesRepository } from './preferences/user-preferences.repository';
import { DeviceSessionRepository } from './sessions/device-session.repository';
import { DeviceSessionsService } from './sessions/device-sessions.service';
import { BetterAuthSessionRevoker, SessionRevoker } from './sessions/session-revoker';

/** Settings > Account: the profile photo, dashboard language and signed-in devices. Name and password go straight to Better Auth. */
@Module({
  imports: [StorageModule],
  controllers: [AccountController],
  providers: [
    UserImageRepository,
    AvatarService,
    UserPreferencesRepository,
    DeviceSessionRepository,
    DeviceSessionsService,
    {
      provide: SessionRevoker,
      inject: [AuthService],
      useFactory: (auth: AuthService<Auth>) => new BetterAuthSessionRevoker(auth),
    },
  ],
})
export class AccountModule {}
