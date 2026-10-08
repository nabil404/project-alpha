# 07.1 · Foundation: the assistant's turn

**Status:** not started.

## Goal

A customer's text message in Messenger gets an AI reply, start to finish:
inbound message → assistant-turn job → LLM (outside any transaction) →
deterministic state machine → reply sent through Graph. Any failure hands the
conversation to the seller with a fixed reply, so the customer is never left
without an answer.

Catalog matching (code matches, the LLM returns raw words), the Confirm button
and order creation are [phase 2](../phase-2-catalog-confirm-orders/README.md).

## Depends on

Nothing. Inbound messages, the 24-hour window check and seller sends already
exist ([04 · Conversations](../../04-conversations/README.md)).

## Flow

```
InboundMessageIngest (after commit, sender = customer, stored)
  └─ if !botPaused && page.botEnabled && state ∉ {handed_off, confirmed} && LLM configured
     → ASSISTANT_QUEUE add('assistant-turn', {merchantId, conversationId, triggerMessageId},
                           {jobId: `turn:${metaMessageId}`, delay: ~2.5s})   // one turn per burst
AssistantTurnProcessor → AssistantTurnService.run()
  1. read (withMerchant): conversation, last ~20 messages, Page token
     bail if paused / handed_off / the trigger is no longer the latest customer message
  2. LLM, no transaction open: classifyIntent (routing model)
     → extractOrder (extraction model) when intent ∈ {order, edit_order}
  3. decideTurn(state, slots, intent, extraction): pure, in conversation-machine.ts
  4. short tx: lock the conversation, re-check step 1, write state + collected_slots
     + the llm_call rows, insert the assistant message as `sending`
  5. send through Graph outside the tx → markSent / markFailed; publish the conversation event
     send failure → handed_off so the seller sees it
```

## Scope

- **Dependencies** (`apps/api`): `ai`, `@ai-sdk/anthropic`. Load the
  `claude-api` skill first and check the installed SDK's structured-output API.
- **Config** (`src/modules/config/env.schema.ts`): fix the
  `LLM_MODEL_EXTRACTION` default to a current model ID; add `LLM_TIMEOUT_MS`
  (default 15000). With no `LLM_API_KEY`, no turns are queued (the same pattern
  as Graph being unconfigured). Add `*.apiKey` to the pino redact list in
  `src/app.module.ts`.
- **`src/modules/llm/`** (new): `LlmClient` with `classifyIntent(history)`,
  `extractOrder(history, slots)` and `phraseReply(intent, facts, history)`,
  validated with `intentResultSchema` / `extractedOrderSchema` from
  `packages/shared/src/schemas/llm.ts`. It never throws: it returns
  `{ ok: true, value, usage }` or `{ ok: false, reason }`, with an
  `AbortSignal.timeout` on each call. Message text is never logged. Provider
  token `LLM`, so tests inject a fake. One prompt file per call in `prompts/`.
- **Cost tracking:** an `llm_call` table in a new `schema/assistant.ts`
  (merchant_id, conversation_id, purpose, model, input and output tokens,
  latency_ms, outcome, created_at), with an RLS policy plus `FORCE` via
  `db:custom`. Its repository takes `Executor` and `TenantScope`. Rows are
  written in the step-4 transaction.
- **Queue** (`src/modules/queue/queue.constants.ts`): `ASSISTANT_QUEUE =
'assistant-turns'`, `ASSISTANT_TURN_JOB` and the `AssistantTurnJob` type,
  registered in `queue.module.ts` (Bull Board picks it up).
- **`src/modules/conversations/assistant/`** (new):
  `assistant-turn.processor.ts` (same shape as `InboundMessageProcessor`: name
  check, Zod parse, `UnrecoverableError`), `assistant-turn.service.ts`,
  `conversation-machine.ts` (pure `decideTurn`), `reply-intent.ts`,
  `reply-check.ts` (pure `checkReply`), `assistant-fallbacks.ts`,
  `assistant.module.ts`, added to `src/worker.module.ts`.
- **Code decides, the LLM phrases.** `decideTurn` returns a typed reply intent,
  not text: `{ kind: 'ask_slot', slot }`, `{ kind: 'summary', facts }`,
  `{ kind: 'handoff' }`. Slot order: product → variant → quantity → name →
  phone → address. `phraseReply` (routing model) writes it in the customer's
  language and tone. `checkReply(text, facts)` then requires every number in
  the reply (prices, quantities, phone digits; Bangla digits normalised) to
  appear in `facts`, caps the length, and rejects URLs. If phrasing fails,
  times out or fails the check, the fixed fallback sentence for that intent is
  sent.
- **Fallbacks** follow the shop's country (`merchant_settings.country`,
  Bangladesh when there is no row): a `country → language` map (BD → `bn`,
  others → `en`) picks from `Record<language, Record<ReplyKind, string>>`; a
  missing entry falls back to English. The hand-off message is always the fixed
  fallback, with no LLM call.
- **Hand-off** (state `handed_off`, fixed reply) when the LLM errors or times
  out, the output fails Zod, confidence is below 0.6, the intent is `complain`
  or `request_human`, or the same slot was asked for three times in a row (a
  counter in `collected_slots`).
- **All slots filled** → `awaiting_confirmation` and a phrased summary. No
  prices yet; phase 2 adds them to `facts`.
- **Shared send path:** factor the store-`sending` → `graph.sendText` →
  `markSent` / `markFailed` → publish sequence out of `ConversationsService.send`
  into an `OutboundMessageSender` used by both, with `sender` as a parameter.
  The 24-hour window check stays.
- **Ingest** (`ingest/inbound-message.ingest.ts`): return the locked
  conversation's `botPaused` and `state` from the transaction and queue the
  turn after `events.publish`.
- **Shared:** a counter field on `collectedSlotsSchema`
  (`packages/shared/src/schemas/conversation.ts`) for repeated confusion. Any
  new enum member follows the three-file rule in `AGENTS.md`.

## Meta / App Review

None new. `pages_messaging` is already requested.

## Rules it must keep

From the MVP [rules](../../../mvp/01-messenger-to-order/rules.md): when unsure,
hand off; if the LLM fails, the customer still gets a reply; never call the LLM
inside a transaction; every repository method takes `merchantId`; never log
tokens or message text.

## Tests

Colocated in `__tests__/`.

- `conversation-machine.spec.ts`: every state × intent; null never overwrites a
  slot; repeated-confusion hand-off; all slots filled → `awaiting_confirmation`.
- `reply-check.spec.ts`: an invented price or quantity is rejected (Latin and
  Bangla digits); allowed facts pass; URLs and over-long replies are rejected.
- `llm.client.spec.ts`: the AI SDK's mock model; timeout, invalid JSON and
  provider errors → `ok: false`.
- `assistant-turn.service.spec.ts`: LLM failure → `handed_off` plus a reply;
  paused or stale trigger → no LLM call; a seller takeover mid-turn is caught by
  the step-4 re-check; Graph failure → `failed` and `handed_off`; phrasing
  failure → fallback sentence.
- `inbound-message.ingest.spec.ts`: queues only for an unpaused customer message
  on an enabled Page; a duplicate queues nothing.
- `llm-call.repository`: two-merchant isolation.

## Done when

- `pnpm --filter @app/shared build && pnpm typecheck && pnpm lint && pnpm test`
  pass.
- Schema loop: `db:generate` → review the SQL → `db:custom` for `FORCE` →
  `db:migrate` → `db:verify-rls`.
- Manually, with a real `LLM_API_KEY`: a message to the dev Page gets an AI
  reply, the turn shows in Bull Board, and an `llm_call` row is written. With a
  bad key, the conversation goes to `handed_off` with the fallback reply.
- The backend skill no longer says `extractOrder()` is not built; the
  [04 · Conversations](../../04-conversations/README.md) status is updated.
