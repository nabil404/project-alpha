import { Inject, Injectable, Logger } from '@nestjs/common';
import type { FacebookPage, FacebookPageCandidate } from '@app/shared';
import { CryptoService } from '../../../common/crypto.service';
import type { TenantScope } from '../../../database/base.repository';
import { DATABASE, type Database } from '../../../database/database.module';
import { uniqueViolationConstraint } from '../../../database/pg-errors';
import {
  FACEBOOK_PAGE_MERCHANT_UQ,
  FACEBOOK_PAGE_PAGE_ID_UQ,
  type FacebookPageRow,
} from '../../../database/schema/index';
import { withMerchant } from '../../../database/with-merchant';
import {
  facebookAuthCancelled,
  facebookAuthExpired,
  facebookAuthFailed,
  facebookPageAlreadyConnected,
  facebookPageNoMessagingAccess,
  facebookPageNotFound,
  facebookPageTaken,
  facebookPermissionsDeclined,
  facebookUnavailable,
  messengerNotConfigured,
} from './facebook-page-errors';
import { FacebookPageRepository } from './facebook-page.repository';
import {
  GraphError,
  MESSAGING_TASK,
  MetaGraphClient,
  PAGE_CONNECT_SCOPES,
} from './meta-graph.client';
import {
  PAGE_CONNECT_TTL_MS,
  newOAuthState,
  openFlow,
  sealFlow,
  stateMatches,
  type FlowOwner,
  type PageConnectFlow,
} from './page-connect-flow';

/** Null when FACEBOOK_CLIENT_ID / FACEBOOK_CLIENT_SECRET are unset: connecting answers MESSENGER_NOT_CONFIGURED. */
export const META_GRAPH = Symbol('META_GRAPH');
/** Where Facebook sends the seller back to; must be listed in the Meta app's valid OAuth redirect URIs. */
export const PAGE_CONNECT_REDIRECT_URI = Symbol('PAGE_CONNECT_REDIRECT_URI');

export type PageConnectOwner = TenantScope & FlowOwner;

export interface CallbackParams {
  code?: string;
  state?: string;
  error?: string;
}

/**
 * Connecting a shop's Facebook Page: an OAuth round trip for the Page
 * permissions, a pick among the Pages the seller granted, then storing that
 * Page's token encrypted and subscribing our app to its webhooks.
 *
 * Every Graph call runs outside a transaction (backend invariant #1): read,
 * call Facebook, then open a short transaction that locks, re-checks and
 * writes. The Page access token is encrypted before it reaches a repository
 * and is never logged.
 */
@Injectable()
export class FacebookPageService {
  private readonly logger = new Logger(FacebookPageService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly pages: FacebookPageRepository,
    private readonly crypto: CryptoService,
    @Inject(META_GRAPH) private readonly graph: MetaGraphClient | null,
    @Inject(PAGE_CONNECT_REDIRECT_URI) private readonly redirectUri: string,
  ) {}

  async get(scope: TenantScope): Promise<FacebookPage | null> {
    const row = await withMerchant(this.db, scope.merchantId, (tx) =>
      this.pages.findForMerchant(tx, scope),
    );
    return row ? toFacebookPage(row) : null;
  }

  /** The Facebook dialog to send the browser to, and the sealed flow cookie to set first. */
  start(owner: PageConnectOwner, now = Date.now()): { url: string; cookie: string } {
    const graph = this.requireGraph();
    const state = newOAuthState();
    const cookie = sealFlow(this.crypto, {
      stage: 'authorizing',
      state,
      userId: owner.userId,
      merchantId: owner.merchantId,
      expiresAt: now + PAGE_CONNECT_TTL_MS,
    });
    return { url: graph.authorizeUrl(state, this.redirectUri), cookie };
  }

  /**
   * Facebook's redirect back. Checks `state` before anything else, trades the
   * code for a long-lived user token, and confirms every Page permission was
   * granted. Returns the sealed cookie for the choose-a-Page step.
   */
  async completeAuthorization(
    owner: PageConnectOwner,
    sealed: string | undefined,
    params: CallbackParams,
    now = Date.now(),
  ): Promise<string> {
    const graph = this.requireGraph();
    const flow = openFlow(this.crypto, sealed, owner, now);
    if (flow?.stage !== 'authorizing') throw facebookAuthExpired();
    if (!stateMatches(flow.state, params.state)) throw facebookAuthFailed();
    if (params.error) throw facebookAuthCancelled();
    if (!params.code) throw facebookAuthFailed();

    const userToken = await this.callGraph(
      () => graph.exchangeCode(params.code!, this.redirectUri),
      {
        rejected: facebookAuthFailed,
      },
    );
    const granted = await this.callGraph(() => graph.grantedPermissions(userToken));
    const missing = PAGE_CONNECT_SCOPES.filter((scope) => !granted.has(scope));
    if (missing.length > 0) throw facebookPermissionsDeclined(missing);

    return sealFlow(this.crypto, {
      stage: 'authorized',
      userToken,
      userId: owner.userId,
      merchantId: owner.merchantId,
      expiresAt: now + PAGE_CONNECT_TTL_MS,
    });
  }

  /** The Pages the seller granted access to, to pick one from. */
  async listCandidates(
    owner: PageConnectOwner,
    sealed: string | undefined,
  ): Promise<FacebookPageCandidate[]> {
    const graph = this.requireGraph();
    const { userToken } = this.authorizedFlow(owner, sealed);
    const pages = await this.callGraph(() => graph.listPages(userToken));
    return pages
      .map((page) => ({
        pageId: page.id,
        name: page.name,
        canMessage: page.tasks.includes(MESSAGING_TASK),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Connects one of the seller's Pages, or refreshes the token of the Page
   * the shop already has (a reconnect). A shop has at most one Page; a
   * different one needs a disconnect first.
   */
  async connect(
    owner: PageConnectOwner,
    sealed: string | undefined,
    pageId: string,
  ): Promise<FacebookPage> {
    const graph = this.requireGraph();
    const { userToken } = this.authorizedFlow(owner, sealed);
    const scope: TenantScope = { merchantId: owner.merchantId };

    // A cheap refusal before calling Facebook; the transaction below re-checks.
    const current = await withMerchant(this.db, scope.merchantId, (tx) =>
      this.pages.findForMerchant(tx, scope),
    );
    if (current && current.pageId !== pageId) throw facebookPageAlreadyConnected();

    const page = await this.callGraph(() => graph.getPage(userToken, pageId));
    if (!page) throw facebookPageNotFound(pageId);
    if (!page.tasks.includes(MESSAGING_TASK)) throw facebookPageNoMessagingAccess(pageId);

    await this.callGraph(() => graph.subscribeApp(page.id, page.accessToken));
    const accessToken = this.crypto.encrypt(page.accessToken);

    try {
      const row = await withMerchant(this.db, scope.merchantId, async (tx) => {
        const existing = await this.pages.findForMerchant(tx, scope, { lock: true });
        if (existing && existing.pageId !== page.id) throw facebookPageAlreadyConnected();
        return existing
          ? this.pages.update(tx, scope, existing.id, { name: page.name, accessToken })
          : this.pages.insert(tx, scope, { pageId: page.id, name: page.name, accessToken });
      });
      return toFacebookPage(row);
    } catch (error) {
      // No unsubscribe here: when the Page is another shop's, that shop's
      // webhooks depend on the subscription we just re-confirmed.
      const constraint = uniqueViolationConstraint(error);
      if (constraint === FACEBOOK_PAGE_PAGE_ID_UQ) throw facebookPageTaken(page.id);
      if (constraint === FACEBOOK_PAGE_MERCHANT_UQ) throw facebookPageAlreadyConnected();
      throw error;
    }
  }

  /**
   * Forgets the shop's Page, then unsubscribes our app from it, best-effort:
   * once the row is gone, a webhook from that Page resolves to no shop and is
   * dropped anyway. Idempotent.
   */
  async disconnect(scope: TenantScope): Promise<void> {
    const row = await withMerchant(this.db, scope.merchantId, (tx) =>
      this.pages.deleteForMerchant(tx, scope),
    );
    if (!row || !this.graph) return;

    try {
      await this.graph.unsubscribeApp(row.pageId, this.crypto.decrypt(row.accessToken));
    } catch (error) {
      // GraphError messages carry no token or URL; anything else is reduced to its name.
      const reason = error instanceof GraphError ? error.message : (error as Error).name;
      this.logger.warn(`Could not unsubscribe from Page ${row.pageId}: ${reason}`);
    }
  }

  private requireGraph(): MetaGraphClient {
    if (!this.graph) throw messengerNotConfigured();
    return this.graph;
  }

  private authorizedFlow(
    owner: PageConnectOwner,
    sealed: string | undefined,
  ): Extract<PageConnectFlow, { stage: 'authorized' }> {
    const flow = openFlow(this.crypto, sealed, owner);
    if (flow?.stage !== 'authorized') throw facebookAuthExpired();
    return flow;
  }

  /**
   * Facebook's answer as a coded error: an expired or revoked user token
   * (Graph code 190) means start again, another refusal is `rejected`, and
   * anything else - 5xx, timeouts - is Facebook being unavailable.
   */
  private async callGraph<T>(
    call: () => Promise<T>,
    { rejected = facebookAuthFailed }: { rejected?: () => Error } = {},
  ): Promise<T> {
    try {
      return await call();
    } catch (error) {
      if (!(error instanceof GraphError)) throw error;
      if (error.graphCode === 190) throw facebookAuthExpired();
      if (error.status >= 400 && error.status < 500) throw rejected();
      throw facebookUnavailable();
    }
  }
}

export function toFacebookPage(row: FacebookPageRow): FacebookPage {
  return {
    id: row.id,
    pageId: row.pageId,
    name: row.name,
    botEnabled: row.botEnabled,
    connectedAt: row.createdAt.toISOString(),
  };
}
