import type { InboundMessageJob } from '../queue/queue.constants.js';

export interface MetaWebhookBody {
  object?: string;
  entry?: {
    id?: string;
    messaging?: {
      sender?: { id?: string };
      timestamp?: number;
      message?: { mid?: string; text?: string; is_echo?: boolean };
    }[];
  }[];
}

export function parseInboundJobs(body: MetaWebhookBody): InboundMessageJob[] {
  if (body.object !== 'page') {
    return [];
  }

  const jobs: InboundMessageJob[] = [];
  for (const entry of body.entry ?? []) {
    for (const event of entry.messaging ?? []) {
      const { mid, text, is_echo: isEcho } = event.message ?? {};
      // Echoes are the seller's own replies; they pause the bot, they are not customer input.
      if (!mid || !text || isEcho || !entry.id || !event.sender?.id) {
        continue;
      }
      jobs.push({
        messageId: mid,
        pageId: entry.id,
        senderPsid: event.sender.id,
        text,
        sentAt: event.timestamp ?? Date.now(),
      });
    }
  }
  return jobs;
}
