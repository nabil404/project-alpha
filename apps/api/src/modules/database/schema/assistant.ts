import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, pgTable, text } from 'drizzle-orm/pg-core';
import { createdAt, id, merchantId, merchantIsolation, oneOf } from './columns';
import { conversation } from './conversations';
import { productImport } from './imports';

/** Literal copies of llm.types (drizzle-kit loads this file on its own); llm-call.repository.spec keeps them equal. */
export const LLM_CALL_PURPOSES = [
  'classify',
  'extract',
  'phrase',
  'vision_match',
  'post_import',
] as const;
export const LLM_CALL_OUTCOMES = ['ok', 'timeout', 'provider_error', 'invalid_output'] as const;

/**
 * One row per LLM call, for cost per shop: the assistant's, per conversation,
 * and an import run's, per run. Exactly one of the two is set. Never carries
 * message text or model output.
 */
export const llmCall = pgTable(
  'llm_call',
  {
    id: id(),
    merchantId: merchantId(),
    conversationId: text('conversation_id'),
    importId: text('import_id'),
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
    foreignKey({
      name: 'llm_call_import_fk',
      columns: [t.merchantId, t.importId],
      foreignColumns: [productImport.merchantId, productImport.id],
    }).onDelete('cascade'),
    check('llm_call_owner_ck', sql`num_nonnulls(${t.conversationId}, ${t.importId}) = 1`),
    check('llm_call_purpose_ck', oneOf(t.purpose, LLM_CALL_PURPOSES)),
    check('llm_call_outcome_ck', oneOf(t.outcome, LLM_CALL_OUTCOMES)),
    index('llm_call_merchant_created_idx').on(t.merchantId, t.createdAt),
    index('llm_call_merchant_import_idx').on(t.merchantId, t.importId),
    merchantIsolation('llm_call_merchant_isolation', t.merchantId),
  ],
);

export type LlmCallRow = typeof llmCall.$inferSelect;
