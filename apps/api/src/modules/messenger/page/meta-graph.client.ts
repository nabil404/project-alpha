import { createHmac } from 'node:crypto';
import { PROFILE_FIELDS, type MessengerProfileBody } from '../profile/messenger-profile';

/**
 * What a Page cannot be connected without. `pages_show_list` lists the
 * seller's Pages, `pages_messaging` reads and answers their chats, and
 * `pages_manage_metadata` subscribes our app to a Page's webhooks. Sign-in
 * itself asks for `public_profile` and `email` only (auth.config.ts).
 */
export const PAGE_REQUIRED_SCOPES = [
  'pages_show_list',
  'pages_messaging',
  'pages_manage_metadata',
] as const;

/**
 * Asked for, but a seller who declines it still connects:
 * `pages_read_engagement` reads a shared post's caption and lists the Page's
 * posts for the product page's picker. Without it, only posts linked by a
 * pasted link resolve.
 */
export const PAGE_OPTIONAL_SCOPES = ['pages_read_engagement'] as const;

/** What the Page connection flow asks Facebook for. */
export const PAGE_CONNECT_SCOPES = [...PAGE_REQUIRED_SCOPES, ...PAGE_OPTIONAL_SCOPES] as const;

/**
 * The webhook fields a connected Page delivers. Echoes are how a seller's own
 * reply pauses the bot; referrals carry links and ads; reactions and edits are
 * stored and shown, and never confirm an order.
 */
export const PAGE_WEBHOOK_FIELDS = [
  'messages',
  'messaging_postbacks',
  'message_echoes',
  'messaging_referrals',
  'message_reactions',
  'message_edits',
] as const;

/** A Page role's capabilities; the assistant needs MESSAGING to answer chats. */
export const MESSAGING_TASK = 'MESSAGING';

export interface GraphSettings {
  appId: string;
  appSecret: string;
  /** Pinned Graph API version, e.g. `v21.0`. */
  version: string;
}

export interface GraphPage {
  id: string;
  name: string;
  tasks: string[];
}

export interface GraphPageWithToken extends GraphPage {
  accessToken: string;
}

/** A Page post as Graph returns it; any field Facebook leaves out is null. */
export interface GraphPost {
  /** `<page id>_<post id>`. */
  id: string;
  message: string | null;
  permalinkUrl: string | null;
  /** https only. */
  pictureUrl: string | null;
  createdTime: string | null;
}

/** How many of the Page's recent posts the picker lists. */
export const PAGE_POSTS_LIMIT = 25;

/** A Page post as an import reads it: every photo of an album, not only the first. */
export interface GraphImportPost {
  /** `<page id>_<post id>`. */
  id: string;
  message: string | null;
  permalinkUrl: string | null;
  createdTime: string | null;
  /** https photo links, in the post's order; videos are left out. */
  photoUrls: string[];
}

/** One page of a Page's published posts and the cursor of the page after it, null on the last. */
export interface GraphPostPage {
  posts: GraphImportPost[];
  after: string | null;
}

/** Posts per page an import reads. */
export const IMPORT_POSTS_PAGE_SIZE = 25;

/**
 * Graph refused for want of a permission (10, 200 to 299) or a valid token
 * (190): the seller must reconnect the Page to grant it.
 */
export function isPermissionError(error: unknown): boolean {
  if (!(error instanceof GraphError)) return false;
  const code = error.graphCode;
  return code === 10 || code === 190 || (code !== undefined && code >= 200 && code < 300);
}

export interface GraphUserProfile {
  name: string | null;
  /** A signed CDN link that expires after a few days. */
  pictureUrl: string | null;
}

/**
 * A failed Graph call. Carries Facebook's status and error code but never the
 * request URL or a token, so it is safe to log.
 */
export class GraphError extends Error {
  constructor(
    readonly status: number,
    readonly graphCode: number | undefined,
    message: string,
    readonly graphSubcode?: number,
  ) {
    super(message);
    this.name = 'GraphError';
  }
}

type FetchFn = typeof fetch;

/** A quick reply or button: what the customer sees and what comes back when they tap it. */
export interface GraphOption {
  title: string;
  payload: string;
}

/** Messenger's limits: 13 quick replies and 3 buttons, 20 characters a title, 640 for a button template's text. */
export const QUICK_REPLY_MAX = 13;
export const BUTTON_MAX = 3;
export const OPTION_TITLE_MAX = 20;
export const BUTTON_TEXT_MAX = 640;
/** A carousel holds up to ten cards; a card's title and subtitle take 80 characters each. */
export const CAROUSEL_MAX = 10;
export const CARD_TITLE_MAX = 80;

/** One carousel card: a photo, a title, a line under it, and one postback button. */
export interface GraphCard {
  title: string;
  subtitle: string;
  imageUrl: string | null;
  button: GraphOption;
}

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/**
 * Cut to at most `max` characters, counted as code points (a Bangla letter
 * with its vowel sign is two), never splitting a grapheme; an ellipsis marks
 * the cut.
 */
export function cutText(text: string, max: number): string {
  if (Array.from(text).length <= max) return text;
  let kept = '';
  let length = 0;
  for (const { segment } of graphemes.segment(text)) {
    const size = Array.from(segment).length;
    if (length + size > max - 1) break;
    kept += segment;
    length += size;
  }
  return `${kept}…`;
}

const REQUEST_TIMEOUT_MS = 10_000;

/**
 * The Graph API over `fetch`, at a pinned version. Tokens go in the
 * Authorization header and every call carries `appsecret_proof`, so a leaked
 * token is useless without our app secret. Never call it inside a database
 * transaction (invariant #1).
 */
export class MetaGraphClient {
  private readonly graphBase: string;

  constructor(
    private readonly settings: GraphSettings,
    private readonly fetchFn: FetchFn = fetch,
  ) {
    this.graphBase = `https://graph.facebook.com/${settings.version}`;
  }

  /** The Login dialog for the Page permissions. `state` binds the answer to this browser. */
  authorizeUrl(state: string, redirectUri: string): string {
    const url = new URL(`https://www.facebook.com/${this.settings.version}/dialog/oauth`);
    url.search = new URLSearchParams({
      client_id: this.settings.appId,
      redirect_uri: redirectUri,
      state,
      response_type: 'code',
      scope: PAGE_CONNECT_SCOPES.join(','),
      // A seller who declined a permission and tries again is asked again.
      auth_type: 'rerequest',
    }).toString();
    return url.toString();
  }

  /**
   * Code -> short-lived user token -> long-lived user token. Page tokens read
   * with a long-lived user token do not expire, which is what a Page left
   * connected for months needs.
   */
  async exchangeCode(code: string, redirectUri: string): Promise<string> {
    const short = await this.request<{ access_token?: string }>('GET', '/oauth/access_token', {
      query: {
        client_id: this.settings.appId,
        client_secret: this.settings.appSecret,
        redirect_uri: redirectUri,
        code,
      },
    });
    if (!short.access_token) throw new GraphError(502, undefined, 'No access token in exchange');

    const long = await this.request<{ access_token?: string }>('GET', '/oauth/access_token', {
      query: {
        grant_type: 'fb_exchange_token',
        client_id: this.settings.appId,
        client_secret: this.settings.appSecret,
        fb_exchange_token: short.access_token,
      },
    });
    if (!long.access_token) throw new GraphError(502, undefined, 'No long-lived access token');
    return long.access_token;
  }

  /** The permissions the seller actually granted; the dialog lets them untick any. */
  async grantedPermissions(userToken: string): Promise<Set<string>> {
    const body = await this.request<{ data?: { permission?: string; status?: string }[] }>(
      'GET',
      '/me/permissions',
      { token: userToken },
    );
    return new Set(
      (body.data ?? [])
        .filter((entry) => entry.status === 'granted' && typeof entry.permission === 'string')
        .map((entry) => entry.permission as string),
    );
  }

  /** The first 100 Pages the seller granted us, more than any one seller in the MVP has. */
  async listPages(userToken: string): Promise<GraphPage[]> {
    const entries = await this.grantedPages(userToken, 'id,name,tasks');
    return entries.flatMap((entry) => {
      const page = toGraphPage(entry);
      return page ? [page] : [];
    });
  }

  /**
   * One of the seller's granted Pages with its Page access token, or null if
   * it is not among them. Read from `/me/accounts`, not `/{page-id}`: `tasks`
   * is the seller's role on the Page, a field of that edge only, and asking a
   * Page node for it fails with Graph error 100.
   */
  async getPage(userToken: string, pageId: string): Promise<GraphPageWithToken | null> {
    const entries = await this.grantedPages(userToken, 'id,name,tasks,access_token');
    const entry = entries.find((candidate) => toGraphPage(candidate)?.id === pageId);
    const page = toGraphPage(entry);
    const accessToken = (entry as { access_token?: unknown } | undefined)?.access_token;
    if (!page || typeof accessToken !== 'string' || !accessToken) return null;
    return { ...page, accessToken };
  }

  /** Points the Page's Messenger webhooks at our app. Idempotent on Facebook's side. */
  async subscribeApp(pageId: string, pageToken: string): Promise<void> {
    await this.request('POST', `/${encodeURIComponent(pageId)}/subscribed_apps`, {
      token: pageToken,
      query: { subscribed_fields: PAGE_WEBHOOK_FIELDS.join(',') },
    });
  }

  async unsubscribeApp(pageId: string, pageToken: string): Promise<void> {
    await this.request('DELETE', `/${encodeURIComponent(pageId)}/subscribed_apps`, {
      token: pageToken,
    });
  }

  /** The Page's Messenger Profile: Get Started, greeting, ice breakers and menu. Replaces each field sent. */
  async setMessengerProfile(pageToken: string, body: MessengerProfileBody): Promise<void> {
    await this.request('POST', '/me/messenger_profile', { token: pageToken, json: body });
  }

  /** Removes our fields, so a disconnected Page keeps no dead buttons. */
  async clearMessengerProfile(pageToken: string): Promise<void> {
    await this.request('DELETE', '/me/messenger_profile', {
      token: pageToken,
      json: { fields: [...PROFILE_FIELDS] },
    });
  }

  /** A customer's Messenger profile; each field is null when Facebook shares none. */
  async getUserProfile(pageToken: string, psid: string): Promise<GraphUserProfile> {
    const body = await this.request<{ name?: unknown; profile_pic?: unknown }>(
      'GET',
      `/${encodeURIComponent(psid)}`,
      { token: pageToken, query: { fields: 'name,profile_pic' } },
    );
    const picture = body.profile_pic;
    return {
      name: typeof body.name === 'string' && body.name ? body.name : null,
      // The dashboard renders it in an <img>, so only an https link gets through.
      pictureUrl: typeof picture === 'string' && picture.startsWith('https://') ? picture : null,
    };
  }

  /** One post by its Graph id, `<page id>_<post id>`; needs `pages_read_engagement`. */
  async getPost(pageToken: string, graphPostId: string): Promise<GraphPost | null> {
    const body = await this.request<unknown>('GET', `/${encodeURIComponent(graphPostId)}`, {
      token: pageToken,
      query: { fields: POST_FIELDS },
    });
    return toGraphPost(body);
  }

  /** The Page's most recent posts, newest first; needs `pages_read_engagement`. */
  async listPagePosts(pageToken: string, pageId: string): Promise<GraphPost[]> {
    const body = await this.request<{ data?: unknown[] }>(
      'GET',
      `/${encodeURIComponent(pageId)}/published_posts`,
      { token: pageToken, query: { fields: POST_FIELDS, limit: String(PAGE_POSTS_LIMIT) } },
    );
    return (body.data ?? []).flatMap((entry) => {
      const post = toGraphPost(entry);
      return post ? [post] : [];
    });
  }

  /**
   * One page of the Page's published posts created between `since` and
   * `until` (exclusive), newest first, from `after` on. Needs
   * `pages_read_engagement`. Reels come from another edge and are not here.
   */
  async listPublishedPosts(
    pageToken: string,
    pageId: string,
    range: { since: Date; until: Date; after?: string | null; limit?: number },
  ): Promise<GraphPostPage> {
    const query: Record<string, string> = {
      fields: IMPORT_POST_FIELDS,
      since: String(Math.floor(range.since.getTime() / 1000)),
      until: String(Math.floor(range.until.getTime() / 1000)),
      limit: String(range.limit ?? IMPORT_POSTS_PAGE_SIZE),
    };
    if (range.after) query.after = range.after;
    const body = await this.request<{
      data?: unknown[];
      paging?: { cursors?: { after?: unknown }; next?: unknown };
    }>('GET', `/${encodeURIComponent(pageId)}/published_posts`, { token: pageToken, query });
    const after = body.paging?.cursors?.after;
    return {
      posts: (body.data ?? []).flatMap((entry) => {
        const post = toGraphImportPost(entry);
        return post ? [post] : [];
      }),
      // Graph sends a cursor on the last page too; only `next` says there is more.
      after: typeof body.paging?.next === 'string' && typeof after === 'string' ? after : null,
    };
  }

  /** One post by its Graph id, with every photo, as an import reads it. */
  async getImportPost(pageToken: string, graphPostId: string): Promise<GraphImportPost | null> {
    const body = await this.request<unknown>('GET', `/${encodeURIComponent(graphPostId)}`, {
      token: pageToken,
      query: { fields: IMPORT_POST_FIELDS },
    });
    return toGraphImportPost(body);
  }

  /**
   * A text reply inside the 24h window (`messaging_type: RESPONSE`). The caller
   * enforces the window; If Facebook refuses anyway, the call throws a GraphError.
   */
  async sendText(pageToken: string, psid: string, text: string): Promise<{ messageId: string }> {
    return this.sendMessage(pageToken, psid, { text });
  }

  /** Text with quick-reply chips under it; the chips disappear once one is tapped. */
  async sendQuickReplies(
    pageToken: string,
    psid: string,
    text: string,
    options: readonly GraphOption[],
  ): Promise<{ messageId: string }> {
    return this.sendMessage(pageToken, psid, {
      text,
      quick_replies: options.slice(0, QUICK_REPLY_MAX).map((option) => ({
        content_type: 'text',
        title: cutText(option.title, OPTION_TITLE_MAX),
        payload: option.payload,
      })),
    });
  }

  /** A button template: text up to 640 characters and postback buttons. */
  async sendButtonTemplate(
    pageToken: string,
    psid: string,
    text: string,
    buttons: readonly GraphOption[],
  ): Promise<{ messageId: string }> {
    return this.sendMessage(pageToken, psid, {
      attachment: {
        type: 'template',
        payload: {
          template_type: 'button',
          text: cutText(text, BUTTON_TEXT_MAX),
          buttons: buttons.slice(0, BUTTON_MAX).map((button) => ({
            type: 'postback',
            title: cutText(button.title, OPTION_TITLE_MAX),
            payload: button.payload,
          })),
        },
      },
    });
  }

  /** A carousel (generic template) of up to ten cards. */
  async sendGenericTemplate(
    pageToken: string,
    psid: string,
    cards: readonly GraphCard[],
  ): Promise<{ messageId: string }> {
    return this.sendMessage(pageToken, psid, {
      attachment: {
        type: 'template',
        payload: {
          template_type: 'generic',
          elements: cards.slice(0, CAROUSEL_MAX).map((card) => ({
            title: cutText(card.title, CARD_TITLE_MAX),
            subtitle: cutText(card.subtitle, CARD_TITLE_MAX),
            ...(card.imageUrl ? { image_url: card.imageUrl } : {}),
            buttons: [
              {
                type: 'postback',
                title: cutText(card.button.title, OPTION_TITLE_MAX),
                payload: card.button.payload,
              },
            ],
          })),
        },
      },
    });
  }

  /** An image by its public URL. */
  async sendImage(pageToken: string, psid: string, url: string): Promise<{ messageId: string }> {
    return this.sendMessage(pageToken, psid, {
      attachment: { type: 'image', payload: { url, is_reusable: true } },
    });
  }

  private async sendMessage(
    pageToken: string,
    psid: string,
    message: unknown,
  ): Promise<{ messageId: string }> {
    const body = await this.request<{ message_id?: unknown }>('POST', '/me/messages', {
      token: pageToken,
      json: { recipient: { id: psid }, messaging_type: 'RESPONSE', message },
    });
    if (typeof body.message_id !== 'string' || !body.message_id) {
      throw new GraphError(502, undefined, 'Graph POST /me/messages returned no message id');
    }
    return { messageId: body.message_id };
  }

  private async grantedPages(userToken: string, fields: string): Promise<unknown[]> {
    const body = await this.request<{ data?: unknown[] }>('GET', '/me/accounts', {
      token: userToken,
      query: { fields, limit: '100' },
    });
    return body.data ?? [];
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    {
      token,
      query = {},
      json,
    }: { token?: string; query?: Record<string, string>; json?: unknown } = {},
  ): Promise<T> {
    const url = new URL(`${this.graphBase}${path}`);
    const params = new URLSearchParams(query);
    if (token) {
      params.set('appsecret_proof', appSecretProof(token, this.settings.appSecret));
    }
    url.search = params.toString();

    let response: Response;
    try {
      const headers: Record<string, string> = {};
      if (token) headers.authorization = `Bearer ${token}`;
      if (json !== undefined) headers['content-type'] = 'application/json';
      response = await this.fetchFn(url, {
        method,
        headers,
        body: json === undefined ? undefined : JSON.stringify(json),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      // The underlying error can quote the URL, and the URL can carry a code
      // or client secret: report the failure, not the request.
      throw new GraphError(503, undefined, `Graph ${method} ${path} did not complete`);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = undefined;
    }

    if (!response.ok) {
      const graphError = (
        body as
          { error?: { code?: unknown; error_subcode?: unknown; message?: unknown } } | undefined
      )?.error;
      const graphCode = typeof graphError?.code === 'number' ? graphError.code : undefined;
      const graphSubcode =
        typeof graphError?.error_subcode === 'number' ? graphError.error_subcode : undefined;
      const detail = [
        graphCode === undefined ? undefined : `code ${graphCode}`,
        graphSubcode === undefined ? undefined : `subcode ${graphSubcode}`,
      ].filter(Boolean);
      const reason =
        typeof graphError?.message === 'string' ? scrubGraphMessage(graphError.message) : '';
      throw new GraphError(
        response.status,
        graphCode,
        `Graph ${method} ${path} failed with ${response.status}${detail.length ? ` (${detail.join(', ')})` : ''}${reason ? `: ${reason}` : ''}`,
        graphSubcode,
      );
    }
    return body as T;
  }
}

/**
 * Facebook's own error text names the cause a code alone does not, but it is
 * external input headed for the logs: anything token-shaped is masked and the
 * length capped, so a message that echoes a credential cannot leak it.
 */
function scrubGraphMessage(message: string): string {
  return message
    .replace(/[A-Za-z0-9_\-.|]{32,}/g, '[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

/** HMAC-SHA256 of the token keyed with the app secret, as Graph's "Require App Secret" setting expects. */
export function appSecretProof(token: string, appSecret: string): string {
  return createHmac('sha256', appSecret).update(token).digest('hex');
}

const POST_FIELDS = 'id,message,permalink_url,full_picture,created_time';

function toGraphPost(value: unknown): GraphPost | null {
  if (typeof value !== 'object' || value === null) return null;
  const body = value as Record<string, unknown>;
  const text = (field: unknown) => (typeof field === 'string' && field ? field : null);
  const id = text(body.id);
  if (!id) return null;
  const picture = text(body.full_picture);
  return {
    id,
    message: text(body.message),
    permalinkUrl: text(body.permalink_url),
    pictureUrl: picture?.startsWith('https://') ? picture : null,
    createdTime: text(body.created_time),
  };
}

const IMPORT_POST_FIELDS =
  'id,message,created_time,permalink_url,attachments{media_type,media,subattachments.limit(20){media_type,media}}';

function toGraphImportPost(value: unknown): GraphImportPost | null {
  if (typeof value !== 'object' || value === null) return null;
  const body = value as Record<string, unknown>;
  const text = (field: unknown) => (typeof field === 'string' && field ? field : null);
  const id = text(body.id);
  if (!id) return null;
  const attachments = (body.attachments as { data?: unknown } | undefined)?.data;
  return {
    id,
    message: text(body.message),
    permalinkUrl: text(body.permalink_url),
    createdTime: text(body.created_time),
    photoUrls: [...new Set(Array.isArray(attachments) ? attachments.flatMap(photosOf) : [])],
  };
}

/**
 * The photos of one attachment: itself when it is a photo, its
 * subattachments' photos when it is an album. A video's thumbnail is not a
 * product photo, so videos give none.
 */
function photosOf(attachment: unknown): string[] {
  if (typeof attachment !== 'object' || attachment === null) return [];
  const entry = attachment as { media_type?: unknown; media?: unknown; subattachments?: unknown };
  const children = (entry.subattachments as { data?: unknown } | undefined)?.data;
  if (Array.isArray(children) && children.length > 0) return children.flatMap(photosOf);
  if (entry.media_type !== 'photo' && entry.media_type !== 'album') return [];
  const src = (entry.media as { image?: { src?: unknown } } | undefined)?.image?.src;
  return typeof src === 'string' && src.startsWith('https://') ? [src] : [];
}

function toGraphPage(value: unknown): GraphPage | null {
  if (typeof value !== 'object' || value === null) return null;
  const { id, name, tasks } = value as { id?: unknown; name?: unknown; tasks?: unknown };
  if (typeof id !== 'string' || !id) return null;
  return {
    id,
    name: typeof name === 'string' ? name : '',
    tasks: Array.isArray(tasks)
      ? tasks.filter((task): task is string => typeof task === 'string')
      : [],
  };
}
