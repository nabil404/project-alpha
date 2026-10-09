import { Inject, Injectable } from '@nestjs/common';
import { collectedSlotsSchema, DEFAULT_COUNTRY, type CollectedSlots } from '@app/shared';
import type { TenantScope } from '../../database/base.repository';
import { DATABASE, type Database } from '../../database/database.module';
import { withMerchant } from '../../database/with-merchant';
import {
  LLM,
  type ChatLine,
  type LlmCallRecord,
  type LlmClient,
  type LlmResult,
} from '../../llm/llm.types';
import { FacebookPageRepository } from '../../messenger/page/facebook-page.repository';
import { NotificationsService } from '../../notifications/notifications.service';
import type { AssistantTurnJob } from '../../queue/queue.constants';
import { MerchantSettingsRepository } from '../../settings/merchant-settings.repository';
import { ConversationRepository } from '../conversation.repository';
import { isReplyWindowOpen } from '../conversation-rules';
import { MessageRepository } from '../message.repository';
import { OutboundMessageSender } from '../outbound-message.sender';
import { fallbackText, languageFor, type ReplyLanguage } from './assistant-fallbacks';
import { toChatLines } from './assistant-history';
import {
  decideTurn,
  isActiveState,
  shouldExtract,
  type ActiveState,
  type TurnDecision,
} from './conversation-machine';
import { LlmCallRepository } from './llm-call.repository';
import { checkReply } from './reply-check';
import type { ReplyIntent } from './reply-intent';
import { phraseRequestFor } from './reply-phrasing';
import { turnGate, type TurnGate } from './turn-gate';

/** Messages read for a turn; the phrasing call sees the last PHRASE_HISTORY of them. */
const HISTORY_LIMIT = 20;
const PHRASE_HISTORY = 6;

export type TurnOutcome =
  'replied' | 'handed_off' | 'send_failed' | 'window_closed' | 'no_page' | Exclude<TurnGate, 'go'>;

/**
 * One assistant turn, in the order invariant #1 requires: read, call the LLM
 * with no transaction open, then one short transaction that locks the
 * conversation, re-checks the read, and writes; Graph after commit. LLM and
 * Graph failures never throw - they end in a hand-off with a fixed reply.
 * Only a database or Redis error throws, and BullMQ retries it; the gate's
 * "answered" check makes that retry safe.
 */
@Injectable()
export class AssistantTurnService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly conversations: ConversationRepository,
    private readonly messages: MessageRepository,
    private readonly pages: FacebookPageRepository,
    private readonly settings: MerchantSettingsRepository,
    private readonly llmCalls: LlmCallRepository,
    @Inject(LLM) private readonly llm: LlmClient | null,
    private readonly outbound: OutboundMessageSender,
    private readonly notifications: NotificationsService,
  ) {}

  async run({
    merchantId,
    conversationId,
    triggerMessageId,
  }: AssistantTurnJob): Promise<TurnOutcome> {
    const scope: TenantScope = { merchantId };

    // 1. Read.
    const read = await withMerchant(this.db, merchantId, async (tx) => {
      const found = await this.conversations.findById(tx, scope, conversationId);
      if (!found) return null;
      return {
        ...found,
        recent: await this.messages.listPage(tx, scope, conversationId, { limit: HISTORY_LIMIT }),
        page: await this.pages.findForMerchant(tx, scope),
        country: (await this.settings.find(tx, scope))?.country ?? DEFAULT_COUNTRY,
      };
    });
    if (!read) return 'stale';
    const gate = turnGate(read.conversation, read.recent, triggerMessageId);
    if (gate === 'closed' || gate === 'answered') {
      return (await this.resume(scope, conversationId, read, triggerMessageId, gate)) ?? gate;
    }
    if (gate !== 'go') return gate;
    const state = read.conversation.state;
    if (!isActiveState(state)) return 'closed';
    const page = read.page;
    if (!page || page.pageId !== read.conversation.facebookPageId) return 'no_page';

    // 2. Think, with no transaction open.
    const calls: LlmCallRecord[] = [];
    const history = toChatLines(read.recent);
    const language = languageFor(read.country);
    const decision = await this.decide(
      state,
      readSlots(read.conversation.collectedSlots),
      history,
      read.country,
      calls,
    );
    const text = await this.words(decision.reply, history, language, calls);

    // 3. Re-check under the lock and write.
    const staged = await withMerchant(this.db, merchantId, async (tx) => {
      const locked = await this.conversations.findById(tx, scope, conversationId, { lock: true });
      if (!locked) return { outcome: 'stale' as const };
      await this.llmCalls.insertMany(tx, scope, conversationId, calls);
      const recent = await this.messages.listPage(tx, scope, conversationId, {
        limit: HISTORY_LIMIT,
      });
      const recheck = turnGate(locked.conversation, recent, triggerMessageId);
      if (recheck !== 'go') return { outcome: recheck };
      // The reply must sort after its trigger even when Meta's clock runs ahead of ours.
      const trigger = recent.find((message) => message.id === triggerMessageId);
      const now = new Date(Math.max(Date.now(), (trigger?.sentAt.getTime() ?? 0) + 1));
      if (!isReplyWindowOpen(locked.conversation.lastInboundAt, now))
        return { outcome: 'window_closed' as const };

      const handedOffAt = decision.reply.kind === 'handoff' ? now : null;
      const updated = await this.conversations.update(tx, scope, conversationId, {
        state: decision.state,
        collectedSlots: decision.slots,
        ...(handedOffAt ? { handedOffAt } : {}),
      });
      if (!updated) return { outcome: 'stale' as const };
      const row = await this.outbound.stage(tx, scope, updated, { sender: 'assistant', text, now });
      return { outcome: 'go' as const, row, psid: locked.customer.psid, handedOffAt, now };
    });
    if (staged.outcome !== 'go') return staged.outcome;

    // 4. Send after commit.
    const final = await this.outbound.deliver(scope, {
      row: staged.row,
      psid: staged.psid,
      encryptedToken: page.accessToken,
    });
    let handedOffAt = staged.handedOffAt;
    if (final.status === 'failed' && !handedOffAt) {
      handedOffAt = await this.handOffAfterFailedSend(scope, conversationId, staged.now);
    }
    if (handedOffAt) await this.notifications.handedOff(merchantId, conversationId, handedOffAt);
    if (final.status === 'failed') return 'send_failed';
    return handedOffAt ? 'handed_off' : 'replied';
  }

  /**
   * A retry that finds its work already committed: finish what the failed
   * attempt did not. Null when there is nothing to finish. No LLM call.
   */
  private async resume(
    scope: TenantScope,
    conversationId: string,
    read: {
      conversation: { state: string; handedOffAt: Date | null };
      recent: { id: string; sender: string; status: string; sentAt: Date }[];
    },
    triggerMessageId: string,
    gate: 'closed' | 'answered',
  ): Promise<TurnOutcome | null> {
    const trigger = read.recent.find((message) => message.id === triggerMessageId);
    if (!trigger) return null;
    const { conversation } = read;
    if (
      conversation.state === 'handed_off' &&
      conversation.handedOffAt &&
      conversation.handedOffAt >= trigger.sentAt
    ) {
      await this.notifications.handedOff(
        scope.merchantId,
        conversationId,
        conversation.handedOffAt,
      );
      return 'handed_off';
    }
    if (gate !== 'answered') return null;
    const reply = read.recent.find((message) => message.sender === 'assistant');
    if (!reply || reply.sentAt <= trigger.sentAt || reply.status !== 'failed') return null;
    const at = new Date(Math.max(Date.now(), trigger.sentAt.getTime() + 1));
    const wrote = await this.handOffAfterFailedSend(scope, conversationId, at);
    if (!wrote) return null;
    await this.notifications.handedOff(scope.merchantId, conversationId, wrote);
    return 'send_failed';
  }

  /** Under the conversation lock; null (and nothing written) for a chat already paused or handed off. */
  private async handOffAfterFailedSend(
    scope: TenantScope,
    conversationId: string,
    at: Date,
  ): Promise<Date | null> {
    return withMerchant(this.db, scope.merchantId, async (tx) => {
      const locked = await this.conversations.findById(tx, scope, conversationId, { lock: true });
      if (!locked || locked.conversation.botPaused || locked.conversation.state === 'handed_off') {
        return null;
      }
      await this.conversations.update(tx, scope, conversationId, {
        state: 'handed_off',
        handedOffAt: at,
      });
      return at;
    });
  }

  private async decide(
    state: ActiveState,
    slots: CollectedSlots,
    history: ChatLine[],
    country: string,
    calls: LlmCallRecord[],
  ): Promise<TurnDecision> {
    const llm = this.llm;
    if (!llm)
      return decideTurn({ state, slots, classified: 'failed', extracted: 'skipped', country });
    const classified = record(await llm.classifyIntent(history), calls);
    const extracted =
      classified !== 'failed' && shouldExtract(state, classified.intent)
        ? record(await llm.extractOrder(history, slots), calls)
        : 'skipped';
    return decideTurn({ state, slots, classified, extracted, country });
  }

  /** The phrased reply if it passes checkReply; otherwise, and always for a hand-off, the fixed sentence. */
  private async words(
    reply: ReplyIntent,
    history: ChatLine[],
    language: ReplyLanguage,
    calls: LlmCallRecord[],
  ): Promise<string> {
    const fallback = fallbackText(reply, language);
    if (reply.kind === 'handoff' || !this.llm) return fallback;
    const phrased = record(
      await this.llm.phraseReply(phraseRequestFor(reply, language), history.slice(-PHRASE_HISTORY)),
      calls,
    );
    return phrased !== 'failed' && checkReply(phrased, reply.facts).ok ? phrased.trim() : fallback;
  }
}

function record<T>(result: LlmResult<T>, calls: LlmCallRecord[]): T | 'failed' {
  calls.push({ ...result.usage, outcome: result.ok ? 'ok' : result.reason });
  return result.ok ? result.value : 'failed';
}

/** Slots written by an older shape, or by hand, read as nothing collected rather than failing the turn. */
function readSlots(value: unknown): CollectedSlots {
  const parsed = collectedSlotsSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}
