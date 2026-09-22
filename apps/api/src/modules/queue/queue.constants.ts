export const MESSENGER_QUEUE = 'messenger-inbound';

export interface InboundMessageJob {
  /** Meta message ID, also used as the BullMQ jobId so a redelivery is a no-op. */
  messageId: string;
  pageId: string;
  senderPsid: string;
  text: string;
  sentAt: number;
}
