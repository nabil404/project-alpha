import { check, foreignKey, index, integer, pgTable, text } from 'drizzle-orm/pg-core';
import { createdAt, id, merchantId, merchantIsolation, oneOf } from './columns';
import { conversation } from './conversations';

/** Literal copies of llm.types (drizzle-kit loads this file on its own); llm-call.repository.spec keeps them equal. */
export const LLM_CALL_PURPOSES = ['classify', 'extract', 'phrase'] as const;
export const LLM_CALL_OUTCOMES = ['ok', 'timeout', 'provider_error', 'invalid_output'] as const;

/**
 * One row per LLM call the assistant made, for cost per shop and per
 * conversation. Never carries message text or model output.
 */
export const llmCall = pgTable(
  'llm_call',
  {
    id: id(),
    merchantId: merchantId(),
    conversationId: text('conversation_id').notNull(),
    purpose: text('purpose', { enum: LLM_CALL_PURPOSES }).notNull(),
    model: text('model').notNull(),
    /** Null when the provider never answered (timeout, network error). */
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    latencyMs: integer('latency_ms').notNull(),
    outcome: text('outcome', { enum: LLM_CALL_OUTCOMES }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: 'llm_call_conversation_fk',
      columns: [t.merchantId, t.conversationId],
      foreignColumns: [conversation.merchantId, conversation.id],
    }).onDelete('cascade'),
    check('llm_call_purpose_ck', oneOf(t.purpose, LLM_CALL_PURPOSES)),
    check('llm_call_outcome_ck', oneOf(t.outcome, LLM_CALL_OUTCOMES)),
    index('llm_call_merchant_created_idx').on(t.merchantId, t.createdAt),
    merchantIsolation('llm_call_merchant_isolation', t.merchantId),
  ],
);

export type LlmCallRow = typeof llmCall.$inferSelect;
