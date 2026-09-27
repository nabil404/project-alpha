import { Module } from '@nestjs/common';
import { QueueModule } from '../../queue/queue.module';
import { StorageModule } from '../../storage/storage.module';
import { ProductsModule } from '../products.module';
import { StorageSweepProcessor } from './storage-sweep.processor';

/** Worker-only: imported by WorkerModule, never by AppModule. */
@Module({
  imports: [QueueModule, StorageModule, ProductsModule],
  providers: [StorageSweepProcessor],
})
export class StorageMaintenanceModule {}
