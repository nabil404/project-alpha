import { createHmac } from 'node:crypto';

/**
 * What the Page connection flow asks Facebook for. `pages_show_list` lists the
 * seller's Pages, `pages_messaging` reads and answers their chats, and
 * `pages_manage_metadata` subscribes our app to a Page's webhooks. Sign-in
 * itself asks for `public_profile` and `email` only (auth.config.ts).
 */
export const PAGE_CONNECT_SCOPES = [
  'pages_show_list',
  'pages_messaging',
  'pages_manage_metadata',
] as const;

/** The webhook fields a connected Page delivers. Echoes are how a seller's own reply pauses the bot. */
export const PAGE_WEBHOOK_FIELDS = ['messages', 'messaging_postbacks', 'message_echoes'] as const;

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

const REQUEST_TIMEOUT_MS = 10_000;

/**
 * The Graph API over `fetch`, at a pinned version. Tokens travel in the
 * Authorization header rather than the query string, and every call carries
 * `appsecret_proof`, so a leaked user or Page token is useless without our
 * app secret.
 *
 * Nothing here may be called inside a database transaction (backend
 * invariant #1): each call is a network round trip to Facebook.
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

  /** The Pages the seller granted us, first 100 - more than any one seller in the MVP has. */
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

  /**
   * A text reply inside the 24h window (`messaging_type: RESPONSE`). The caller
   * enforces the window; Facebook refusing anyway surfaces as a GraphError.
   */
  async sendText(pageToken: string, psid: string, text: string): Promise<{ messageId: string }> {
    const body = await this.request<{ message_id?: unknown }>('POST', '/me/messages', {
      token: pageToken,
      json: { recipient: { id: psid }, messaging_type: 'RESPONSE', message: { text } },
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
