import { Module } from '@nestjs/common';
import { QueueModule } from '../../queue/queue.module.js';
import { StorageModule } from '../../storage/storage.module.js';
import { ProductsModule } from '../products.module.js';
import { StorageSweepProcessor } from './storage-sweep.processor.js';

/** Worker-only: imported by WorkerModule, never by AppModule. */
@Module({
  imports: [QueueModule, StorageModule, ProductsModule],
  providers: [StorageSweepProcessor],
})
export class StorageMaintenanceModule {}
