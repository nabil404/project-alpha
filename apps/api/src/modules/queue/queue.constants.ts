export const MESSENGER_QUEUE = 'messenger-inbound';

/** The one job name on MESSENGER_QUEUE. */
export const INBOUND_MESSAGE_JOB = 'inbound-message';

interface InboundMessageBase {
  /** Meta message ID, also used as the BullMQ jobId so a redelivery is a no-op. */
  messageId: string;
  /** Facebook's Page id; the worker resolves it to a merchant. */
  pageId: string;
  text: string;
  sentAt: number;
}

/** A customer wrote to the Page. */
export interface CustomerMessageJob extends InboundMessageBase {
  kind: 'customer-message';
  senderPsid: string;
}

/**
 * The Page sent a message: ours (our app id) or the seller's own reply from
 * Facebook's inbox (any other app id, or none), which pauses the assistant.
 */
export interface PageEchoJob extends InboundMessageBase {
  kind: 'page-echo';
  recipientPsid: string;
  appId?: string;
}

export type InboundMessageJob = CustomerMessageJob | PageEchoJob;

/** Housekeeping for object storage. Jobs are scheduled by the worker, never by the API. */
export const STORAGE_QUEUE = 'storage-maintenance';
export const SWEEP_JOB = 'sweep-orphaned-images';

/** Customer profile upkeep. Jobs are scheduled by the worker, never by the API. */
export const PROFILE_QUEUE = 'customer-profiles';
export const REFRESH_PROFILES_JOB = 'refresh-stale-profiles';

/**
 * Seller notification emails. The API and the worker both enqueue the event
 * jobs; only the worker processes them, and each email goes out as its own
 * SEND_EMAIL_JOB so a retry re-sends one message, never the whole batch.
 * Event job ids are built from the event, and BullMQ ignores an add whose id
 * it still holds, so the same event never mails twice while its job is kept:
 * see EVENT_JOB_RETENTION.
 */
export const NOTIFICATIONS_QUEUE = 'notifications';
export const ORDER_DRAFTED_JOB = 'order-drafted';
export const CUSTOMER_WAITING_JOB = 'customer-waiting';
/** Scheduled by the worker, never by the API: finds the shops where it is 9:00. */
export const DAILY_SUMMARY_SCAN_JOB = 'daily-summary-scan';
export const DAILY_SUMMARY_JOB = 'daily-summary';
export const SEND_EMAIL_JOB = 'send-email';

/** How long a handed-off chat waits for the seller before the email. */
export const CUSTOMER_WAITING_DELAY_MS = 10 * 60 * 1000;

/**
 * Event jobs stay a week after they complete, by age alone: the queue's
 * default also caps completed jobs at a count shared with every send, which
 * a busy shop would reach in minutes and so forget the ids that dedupe.
 */
export const EVENT_JOB_RETENTION = { removeOnComplete: { age: 7 * 24 * 3_600 } } as const;

export interface OrderDraftedJob {
  merchantId: string;
  orderId: string;
}

export interface CustomerWaitingJob {
  merchantId: string;
  conversationId: string;
  /** Epoch ms the conversation was handed to the seller. */
  handedOffAt: number;
}

export interface DailySummaryJob {
  merchantId: string;
  /** The shop-local day summarised, yyyy-MM-dd. */
  day: string;
}
