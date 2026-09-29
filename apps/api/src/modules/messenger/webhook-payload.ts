import type { InboundMessageJob } from '../queue/queue.constants';

export interface MetaWebhookBody {
  object?: string;
  entry?: {
    id?: string;
    messaging?: {
      sender?: { id?: string };
      recipient?: { id?: string };
      timestamp?: number;
      message?: { mid?: string; text?: string; is_echo?: boolean; app_id?: number | string };
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
      jobs.push({ kind: 'customer-message', messageId: mid, pageId, senderPsid, text, sentAt });
    }
  }
  return jobs;
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
