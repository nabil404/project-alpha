import { createHash } from 'node:crypto';
import type { InboundMessageJob } from '../queue/queue.constants';

export interface MetaWebhookBody {
  object?: string;
  entry?: {
    id?: string;
    messaging?: {
      sender?: { id?: string };
      recipient?: { id?: string };
      timestamp?: number;
      message?: {
        mid?: string;
        text?: string;
        is_echo?: boolean;
        app_id?: number | string;
        quick_reply?: { payload?: string };
      };
      postback?: { mid?: string; title?: string; payload?: string };
    }[];
  }[];
}

export function parseInboundJobs(body: MetaWebhookBody): InboundMessageJob[] {
  if (body.object !== 'page') {
    return [];
  }

  const jobs: InboundMessageJob[] = [];
  for (const entry of body.entry ?? []) {
    const pageId = entry.id;
    if (!pageId) continue;
    for (const event of entry.messaging ?? []) {
      const postback = postbackJob(pageId, event);
      if (postback) {
        jobs.push(postback);
        continue;
      }
      const { mid, text, is_echo: isEcho, app_id: appId } = event.message ?? {};
      // Text only in the MVP: attachments, stickers, reactions and deliveries carry none.
      if (!mid || !text) continue;
      const sentAt = event.timestamp ?? Date.now();

      if (isEcho) {
        // Sent by the Page: the customer is the recipient.
        const recipientPsid = event.recipient?.id;
        if (!recipientPsid) continue;
        jobs.push({
          kind: 'page-echo',
          messageId: mid,
          pageId,
          recipientPsid,
          text,
          sentAt,
          ...(appId === undefined ? {} : { appId: String(appId) }),
        });
        continue;
      }

      const senderPsid = event.sender?.id;
      if (!senderPsid) continue;
      const payload = event.message?.quick_reply?.payload;
      jobs.push({
        kind: 'customer-message',
        messageId: mid,
        pageId,
        senderPsid,
        text,
        sentAt,
        ...(payload ? { payload } : {}),
      });
    }
  }
  return jobs;
}

type MessagingEvent = NonNullable<
  NonNullable<MetaWebhookBody['entry']>[number]['messaging']
>[number];

/**
 * A button tap. Meta may send it without a mid, so one is derived from the
 * tap itself: a redelivery of the same tap gets the same id and stays a no-op.
 */
function postbackJob(pageId: string, event: MessagingEvent): InboundMessageJob | null {
  const senderPsid = event.sender?.id;
  const payload = event.postback?.payload;
  if (!event.postback || !senderPsid || !payload) return null;
  const sentAt = event.timestamp ?? Date.now();
  const messageId =
    event.postback.mid ??
    `pb-${createHash('sha256').update(`${senderPsid}|${sentAt}|${payload}`).digest('hex')}`;
  return {
    kind: 'customer-postback',
    messageId,
    pageId,
    senderPsid,
    text: event.postback.title || payload,
    payload,
    sentAt,
  };
}

/**
 * A body that passed HMAC verification but isn't a JSON object is Meta sending
 * something we don't understand, not a fault on our side. Parsing defensively
 * here keeps it a 400 instead of an unhandled SyntaxError and a 500.
 */
export function parseWebhookBody(raw: Buffer): MetaWebhookBody | null {
  try {
    const parsed: unknown = JSON.parse(raw.toString('utf8'));
    return typeof parsed === 'object' && parsed !== null ? (parsed as MetaWebhookBody) : null;
  } catch {
    return null;
  }
}
