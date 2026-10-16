import { Processor, WorkerHost } from '@nestjs/bullmq';
import { UnrecoverableError, type Job } from 'bullmq';
import { z } from 'zod';
import {
  CUSTOMER_PHOTO_CONCURRENCY,
  CUSTOMER_PHOTO_QUEUE,
  STORE_PHOTO_JOB,
  type StorePhotoJob,
} from '../../queue/queue.constants';
import { CustomerPhotoStore } from './customer-photo.store';

const storePhotoJobSchema = z.object({
  merchantId: z.string().min(1),
  messageId: z.string().min(1),
});

/** Registered only in WorkerModule, through CustomerPhotosModule. */
@Processor(CUSTOMER_PHOTO_QUEUE, { concurrency: CUSTOMER_PHOTO_CONCURRENCY })
export class CustomerPhotoProcessor extends WorkerHost {
  constructor(private readonly photos: CustomerPhotoStore) {
    super();
  }

  /** Throws only while storage is down, for BullMQ to retry; a photo Meta will not give us is recorded and done. */
  async process(job: Job<StorePhotoJob>): Promise<'stored' | 'not_a_photo'> {
    if (job.name !== STORE_PHOTO_JOB) {
      throw new UnrecoverableError(`Unknown job on ${CUSTOMER_PHOTO_QUEUE}: ${job.name}`);
    }
    const parsed = storePhotoJobSchema.safeParse(job.data);
    if (!parsed.success) {
      throw new UnrecoverableError(`Malformed ${STORE_PHOTO_JOB} job ${job.id ?? ''}`);
    }
    const { merchantId, messageId } = parsed.data;
    const copies = await this.photos.ensureStored({ merchantId }, messageId);
    if (!copies) return 'not_a_photo';
    if (copies.transient) throw new Error(`Object storage refused a photo of message ${messageId}`);
    return 'stored';
  }
}
