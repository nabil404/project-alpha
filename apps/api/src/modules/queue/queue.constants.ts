export const MESSENGER_QUEUE = 'messenger-inbound';

export interface InboundMessageJob {
  /** Meta message ID, also used as the BullMQ jobId so a redelivery is a no-op. */
  messageId: string;
  pageId: string;
  senderPsid: string;
  text: string;
  sentAt: number;
}

/** Housekeeping for object storage. Jobs are scheduled by the worker, never by the API. */
export const STORAGE_QUEUE = 'storage-maintenance';
export const SWEEP_JOB = 'sweep-orphaned-images';
