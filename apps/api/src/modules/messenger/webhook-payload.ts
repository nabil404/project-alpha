import { createHash } from 'node:crypto';
import { parseProductRef } from '@app/shared';
import type {
  InboundAttachment,
  InboundMessageJob,
  Referral,
  SharedLink,
} from '../queue/queue.constants';
import { allowedUrl, linksInText, MAX_LINKS } from './posts/post-links';

export interface RawReferral {
  ref?: string;
  source?: string;
  type?: string;
  ad_id?: string;
}

export interface RawAttachment {
  type?: string;
  /** Echoes put a fallback's title here. */
  title?: string;
  url?: string;
  payload?: {
    url?: string;
    title?: string;
    id?: number | string;
    sticker_id?: number | string;
    coordinates?: { lat?: number; long?: number };
  } | null;
}

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
        referral?: RawReferral;
        sticker_id?: number | string;
        attachments?: RawAttachment[];
        is_deleted?: boolean;
      };
      postback?: { mid?: string; title?: string; payload?: string; referral?: RawReferral };
      referral?: RawReferral;
      reaction?: { mid?: string; action?: string; emoji?: string; reaction?: string };
      message_edit?: { mid?: string; text?: string; num_edit?: number };
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
      const standalone = referralJob(pageId, event);
      if (standalone) {
        jobs.push(standalone);
        continue;
      }
      const postback = postbackJob(pageId, event);
      if (postback) {
        jobs.push(postback);
        continue;
      }
      const change =
        reactionJob(pageId, event) ?? editJob(pageId, event) ?? unsendJob(pageId, event);
      if (change) {
        jobs.push(change);
        continue;
      }
      const { mid, text, is_echo: isEcho, app_id: appId } = event.message ?? {};
      if (!mid) continue;
      const sentAt = event.timestamp ?? Date.now();

      if (isEcho) {
        // Sent by the Page: the customer is the recipient. Text only: a seller's
        // own photo or sticker from Facebook's inbox is not stored yet.
        const recipientPsid = event.recipient?.id;
        if (!recipientPsid || !text) continue;
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
      const links = parseLinks(event.message ?? {});
      const attachments = text ? [] : parseAttachments(event.message ?? {});
      if (!text && attachments.length === 0 && links.length === 0) continue;
      const payload = event.message?.quick_reply?.payload;
      jobs.push({
        kind: 'customer-message',
        messageId: mid,
        pageId,
        senderPsid,
        text: text ?? '',
        sentAt,
        ...(payload ? { payload } : {}),
        ...(attachments.length > 0 ? { attachments } : {}),
        ...(links.length > 0 ? { links } : {}),
        ...withReferral(parseReferral(event.message?.referral)),
      });
    }
  }
  return jobs;
}

type MessagingEvent = NonNullable<
  NonNullable<MetaWebhookBody['entry']>[number]['messaging']
>[number];

const MEDIA_TYPES = ['image', 'video', 'audio', 'file'] as const;
const isMedia = (type: string | undefined): type is (typeof MEDIA_TYPES)[number] =>
  MEDIA_TYPES.some((media) => media === type);

/** Attachments that share a post or a link rather than a file. */
const SHARE_TYPES: ReadonlySet<string> = new Set(['post', 'share', 'fallback']);

const textOf = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

/**
 * The posts and links a message shared: `post`, `share` and `fallback`
 * attachments, then Facebook links in its words, once each. A link is kept
 * only on Facebook's own hosts; a `post` attachment keeps its id whatever its
 * link. A fallback with neither is not a share.
 */
export function parseLinks(message: {
  text?: string;
  attachments?: RawAttachment[];
}): SharedLink[] {
  const links: SharedLink[] = [];
  const seen = new Set<string>();
  const add = (link: SharedLink) => {
    const key = link.url ?? `id:${link.postId}`;
    if (seen.has(key) || links.length >= MAX_LINKS) return;
    seen.add(key);
    links.push(link);
  };
  for (const raw of message.attachments ?? []) {
    if (!raw.type || !SHARE_TYPES.has(raw.type)) continue;
    const rawUrl = textOf(raw.payload?.url) ?? textOf(raw.url);
    const url = rawUrl && allowedUrl(rawUrl) ? rawUrl : null;
    const id = raw.type === 'post' ? raw.payload?.id : undefined;
    const postId = id === undefined || id === null ? null : textOf(String(id));
    if (!url && !postId) continue;
    add({ url, title: textOf(raw.payload?.title) ?? textOf(raw.title), postId });
  }
  for (const url of linksInText(message.text ?? '')) add({ url, title: null, postId: null });
  return links;
}

/**
 * What a message without words carried. A sticker may come as its own type, or
 * (from older clients) as an image with a sticker id; a shared location as
 * coordinates. Anything else Meta adds later is kept as `other`.
 */
export function parseAttachments(message: {
  sticker_id?: number | string;
  attachments?: RawAttachment[];
}): InboundAttachment[] {
  const files = (message.attachments ?? []).filter(
    (raw) =>
      !raw.type || !SHARE_TYPES.has(raw.type) || parseLinks({ attachments: [raw] }).length === 0,
  );
  const parsed = files.map((raw): InboundAttachment => {
    const url = typeof raw.payload?.url === 'string' && raw.payload.url ? raw.payload.url : null;
    const stickerId = raw.payload?.sticker_id ?? message.sticker_id;
    if (raw.type === 'sticker' || (raw.type === 'image' && stickerId !== undefined)) {
      return {
        type: 'sticker',
        url,
        stickerId: stickerId === undefined ? null : String(stickerId),
      };
    }
    const { lat, long } = raw.payload?.coordinates ?? {};
    if (raw.type === 'location' && typeof lat === 'number' && typeof long === 'number') {
      return { type: 'location', lat, long };
    }
    return { type: isMedia(raw.type) ? raw.type : 'other', url };
  });
  if (parsed.length === 0 && message.sticker_id !== undefined) {
    return [{ type: 'sticker', url: null, stickerId: String(message.sticker_id) }];
  }
  return parsed;
}

const eventKey = (...parts: (string | number)[]) =>
  createHash('sha256').update(parts.join('|')).digest('hex');

/** A reaction or its removal. Its id is derived from the event, so a redelivery stays a no-op. */
function reactionJob(pageId: string, event: MessagingEvent): InboundMessageJob | null {
  const senderPsid = event.sender?.id;
  const { mid, action, emoji, reaction } = event.reaction ?? {};
  if (!senderPsid || senderPsid === pageId || !mid) return null;
  if (action !== 'react' && action !== 'unreact') return null;
  const sentAt = event.timestamp ?? Date.now();
  return {
    kind: 'customer-reaction',
    messageId: `rx-${eventKey(senderPsid, mid, action, emoji ?? '', reaction ?? '', sentAt)}`,
    pageId,
    senderPsid,
    targetMid: mid,
    action,
    emoji: emoji ?? '',
    reaction: reaction ?? '',
    text: '',
    sentAt,
  };
}

/** An edit reuses its message's mid; the edit count and time tell redeliveries from new edits. */
function editJob(pageId: string, event: MessagingEvent): InboundMessageJob | null {
  const senderPsid = event.sender?.id;
  const { mid, text, num_edit: count } = event.message_edit ?? {};
  if (!senderPsid || senderPsid === pageId || !mid || typeof text !== 'string') return null;
  const sentAt = event.timestamp ?? Date.now();
  return {
    kind: 'customer-edit',
    messageId: `ed-${eventKey(mid, count ?? '', sentAt)}`,
    pageId,
    senderPsid,
    targetMid: mid,
    text,
    sentAt,
  };
}

/**
 * Meta's Messenger reference does not document unsends; Instagram marks them
 * `is_deleted`, and Messenger is read the same way when it does.
 */
function unsendJob(pageId: string, event: MessagingEvent): InboundMessageJob | null {
  const senderPsid = event.sender?.id;
  const mid = event.message?.mid;
  if (event.message?.is_deleted !== true || !senderPsid || senderPsid === pageId || !mid) {
    return null;
  }
  return {
    kind: 'customer-unsend',
    messageId: `un-${mid}`,
    pageId,
    senderPsid,
    targetMid: mid,
    text: '',
    sentAt: event.timestamp ?? Date.now(),
  };
}

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
    ...withReferral(parseReferral(event.postback.referral)),
  };
}

/** A product link or an ad; null for anything else, which the chat treats as organic. */
export function parseReferral(raw: RawReferral | undefined): Referral | null {
  if (!raw) return null;
  if (raw.source === 'ADS' && typeof raw.ad_id === 'string' && raw.ad_id) {
    return { kind: 'ad', adId: raw.ad_id };
  }
  const productId = typeof raw.ref === 'string' ? parseProductRef(raw.ref) : null;
  return productId ? { kind: 'link', productId } : null;
}

const withReferral = (referral: Referral | null) => (referral ? { referral } : {});

/**
 * A returning customer opened a link or an ad: no message, no postback. The
 * id is derived from the event, so a redelivery stays a no-op.
 */
function referralJob(pageId: string, event: MessagingEvent): InboundMessageJob | null {
  const senderPsid = event.sender?.id;
  if (event.message || event.postback || !senderPsid) return null;
  const referral = parseReferral(event.referral);
  if (!referral) return null;
  const sentAt = event.timestamp ?? Date.now();
  const key = referral.kind === 'ad' ? `ad:${referral.adId}` : `link:${referral.productId}`;
  return {
    kind: 'customer-referral',
    messageId: `rf-${createHash('sha256').update(`${senderPsid}|${sentAt}|${key}`).digest('hex')}`,
    pageId,
    senderPsid,
    text: '',
    referral,
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
