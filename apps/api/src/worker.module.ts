import { Module } from '@nestjs/common';
import { AppModule } from './app.module';
import { StorageMaintenanceModule } from './modules/products/images/storage-maintenance.module';

/**
 * Everything the API has, plus the queue processors. The API boots AppModule
 * alone, so processors registered here never run in the HTTP process.
 */
@Module({
  imports: [AppModule, StorageMaintenanceModule],
})
export class WorkerModule {}
