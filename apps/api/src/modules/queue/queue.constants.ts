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

/** Where a chat came from: a product link (`m.me/<page>?ref=p_<id>`) or an ad. */
export type Referral = { kind: 'link'; productId: string } | { kind: 'ad'; adId: string };

/** Something sent in place of words. Meta's links expire. */
export type InboundAttachment =
  | { type: 'sticker'; url: string | null; stickerId: string | null }
  | { type: 'location'; lat: number; long: number }
  | { type: 'image' | 'video' | 'audio' | 'file' | 'other'; url: string | null };

/**
 * A Facebook post, ad or link shared or pasted into the chat. `url` is kept
 * only on Facebook's own hosts; `postId` is the id a `post` attachment
 * carries.
 */
export interface SharedLink {
  url: string | null;
  title: string | null;
  postId: string | null;
}

/**
 * A customer wrote to the Page, or tapped one of our quick replies (which
 * carries its payload). With no words, `text` is '' and `attachments` holds
 * what they sent instead.
 */
export interface CustomerMessageJob extends InboundMessageBase {
  kind: 'customer-message';
  senderPsid: string;
  payload?: string;
  referral?: Referral;
  attachments?: InboundAttachment[];
  /** Posts and links shared or pasted, with or without words. */
  links?: SharedLink[];
}

/**
 * A customer reacted to a message, or took a reaction back. Meta sends no mid
 * of its own, so `messageId` is derived from the event; `text` is ''.
 */
export interface CustomerReactionJob extends InboundMessageBase {
  kind: 'customer-reaction';
  senderPsid: string;
  /** The mid of the message reacted to. */
  targetMid: string;
  action: 'react' | 'unreact';
  emoji: string;
  /** Meta's label: like, love, smile and so on. */
  reaction: string;
}

/**
 * A customer edited a message. It reuses the message's mid, so `messageId`
 * adds the edit's time; `text` is the new text.
 */
export interface CustomerEditJob extends InboundMessageBase {
  kind: 'customer-edit';
  senderPsid: string;
  targetMid: string;
}

/** A customer unsent a message; `text` is ''. */
export interface CustomerUnsendJob extends InboundMessageBase {
  kind: 'customer-unsend';
  senderPsid: string;
  targetMid: string;
}

/**
 * A customer tapped a button of ours. `text` is the button's title and
 * `messageId` Meta's mid, or one derived from the tap when Meta sends none.
 */
export interface CustomerPostbackJob extends InboundMessageBase {
  kind: 'customer-postback';
  senderPsid: string;
  payload: string;
  referral?: Referral;
}

/**
 * A returning customer opened a link or an ad: no message, no postback.
 * The parser sets `text` to ''; the ingest fills it in.
 */
export interface CustomerReferralJob extends InboundMessageBase {
  kind: 'customer-referral';
  senderPsid: string;
  referral: Referral;
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

export type InboundMessageJob =
  | CustomerMessageJob
  | CustomerPostbackJob
  | CustomerReferralJob
  | CustomerReactionJob
  | CustomerEditJob
  | CustomerUnsendJob
  | PageEchoJob;

/** Housekeeping for object storage. Jobs are scheduled by the worker, never by the API. */
export const STORAGE_QUEUE = 'storage-maintenance';
export const SWEEP_JOB = 'sweep-orphaned-images';

/** Customer profile upkeep. Jobs are scheduled by the worker, never by the API. */
export const PROFILE_QUEUE = 'customer-profiles';
export const REFRESH_PROFILES_JOB = 'refresh-stale-profiles';

/**
 * Seller notification emails. The API and worker enqueue event jobs; only the
 * worker processes them. Each email is its own SEND_EMAIL_JOB, so a retry
 * resends one message. Event job ids come from the event, and BullMQ ignores an
 * add whose id it still holds, so an event never mails twice within
 * EVENT_JOB_RETENTION.
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

/**
 * The assistant's turns. Queued by the worker's ingest after a stored customer
 * message, delayed so a burst ("hi" / "red saree" / "2 pcs") gets one answer:
 * every message queues, and each turn runs only if its message is still the
 * customer's latest.
 */
export const ASSISTANT_QUEUE = 'assistant-turns';
export const ASSISTANT_TURN_JOB = 'assistant-turn';
export const ASSISTANT_TURN_DELAY_MS = 2_500;
/**
 * A Confirm retry that finds its reference under another run's send lease
 * throws to wait the lease out, so the backoff after every attempt but the
 * last must outlast SEND_LEASE_SECONDS (20 s). The queue default, 1 s doubling
 * over 5 attempts, spends only 15 s in all; from 3 s the last gap alone is 24 s.
 */
export const ASSISTANT_TURN_RETRY = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 3_000 },
} as const;
/**
 * Turns spend most of their time waiting on the LLM and hold a connection only
 * in their short transactions, so 4 stays well under DATABASE_POOL_MAX (10)
 * next to the other processors. Raise it only after measuring.
 */
export const ASSISTANT_CONCURRENCY = 4;

export interface AssistantTurnJob {
  merchantId: string;
  conversationId: string;
  /** Our message row id of the customer message that queued the turn. */
  triggerMessageId: string;
}

/**
 * The Page's Messenger Profile (Get Started, greeting, ice breakers, menu).
 * The API and the worker enqueue SYNC_PROFILE_JOB; only the worker processes
 * it, and only the worker adds RESUBSCRIBE_PAGES_JOB. That runs once; bump the
 * job id (e.g. -v2) to run it again for a new webhook field.
 */
export const CUSTOMER_PHOTO_QUEUE = 'customer-photos';
export const STORE_PHOTO_JOB = 'store-photo';
/** Downloads wait on Meta's CDN, not the database; a few at once keep a slow one from holding the rest. */
export const CUSTOMER_PHOTO_CONCURRENCY = 2;

/** Copy a customer's photo message into our bucket; the job id is `ph-` plus the message id. */
export interface StorePhotoJob {
  merchantId: string;
  /** Our message row id. */
  messageId: string;
}

export const MESSENGER_PROFILE_QUEUE = 'messenger-profile';
export const SYNC_PROFILE_JOB = 'sync-profile';
export const RESUBSCRIBE_PAGES_JOB = 'resubscribe-pages';

/** Carries no settings: the job reads the shop's latest when it runs. */
export interface SyncProfileJob {
  merchantId: string;
  /** Also re-subscribe the Page's webhooks, for Pages connected before a field was added. */
  resubscribe?: boolean;
}
