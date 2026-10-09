# 11.1 · Foundation: the assistant's turn

**Status:** built (Oct 2026).

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
                           {jobId: `turn-${metaMessageId}`, delay: 2500 ms})   // one turn per burst
AssistantTurnProcessor → AssistantTurnService.run()
  1. read (withMerchant): conversation, last ~20 messages, Page token
     bail if paused / handed_off / the trigger is no longer the latest customer message
  2. LLM, no transaction open: classifyIntent (routing model)
     → extractOrder (extraction model): in browsing only for order / edit_order; in
       collecting_details and awaiting_confirmation for every intent except
       complain / request_human (shouldExtract)
  3. decideTurn(state, slots, intent, extraction): pure, in conversation-machine.ts
  4. short tx: lock the conversation, re-check step 1, write state + collected_slots
     + the llm_call rows, insert the assistant message as `sending`
  5. send through Graph outside the tx → markSent / markFailed; publish the conversation event
     send failure → handed_off so the seller sees it
```

## Scope

- **Dependencies** (`apps/api`): `ai` 7.x and `@ai-sdk/openai`.
- **Config** (`src/modules/config/env.schema.ts`; the key and models are set up
  as in [LLM setup](../../../setup/llm-setup.md)): `LLM_PROVIDER` accepts only
  `openai`; the defaults are `LLM_MODEL_ROUTING=gpt-6-luna` (OpenAI's efficient
  tier) and `LLM_MODEL_EXTRACTION=gpt-6.1-sol` (the mid tier), from
  [OpenAI's models page](https://developers.openai.com/api/docs/models); `LLM_TIMEOUT_MS` (default 15000). With no `LLM_API_KEY`, no turns are queued (the same pattern
  as Graph being unconfigured). `*.apiKey` is in the pino redact list in
  `src/app.module.ts`.
- **`src/modules/llm/`**: `LlmClient` with `classifyIntent(history)`,
  `extractOrder(history, slots)` and `phraseReply(intent, facts, history)`,
  validated with `intentResultSchema` / `extractedOrderSchema` from
  `packages/shared/src/schemas/llm.ts`. It never throws: it returns
  `{ ok: true, value, usage }` or `{ ok: false, reason }`, with an
  `AbortSignal.timeout` on each call. Message text is never logged. Provider
  token `LLM`, so tests inject a fake. One prompt file per call in `prompts/`.
- **Cost tracking:** an `llm_call` table in `schema/assistant.ts`
  (merchant_id, conversation_id, purpose, model, input and output tokens,
  latency_ms, outcome, created_at), with an RLS policy plus `FORCE` via
  `db:custom`. Its repository takes `Executor` and `TenantScope`. Rows are
  written in the step-4 transaction.
- **Queue** (`src/modules/queue/queue.constants.ts`): `ASSISTANT_QUEUE =
'assistant-turns'`, `ASSISTANT_TURN_JOB` and the `AssistantTurnJob` type,
  registered in `queue.module.ts` (Bull Board picks it up).
- **`src/modules/conversations/assistant/`**:
  `assistant-turn.processor.ts` (same shape as `InboundMessageProcessor`: name
  check, Zod parse, `UnrecoverableError`), `assistant-turn.service.ts`,
  `conversation-machine.ts` (pure `decideTurn`), `reply-intent.ts`,
  `reply-check.ts` (pure `checkReply`), `assistant-fallbacks.ts`,
  `assistant.module.ts`, added to `src/worker.module.ts`.
- **Code decides, the LLM phrases.** `decideTurn` returns a typed reply intent,
  not text: `{ kind: 'ask_slot', slot }`, `{ kind: 'summary', facts }`,
  `{ kind: 'handoff' }`. Slot order: product → quantity → name → phone →
  address (no variant slot until phase 2). `phraseReply` (routing model) writes it in the customer's
  language and tone. `checkReply(text, facts)` then requires every number in
  the reply (prices, quantities, phone digits; Bangla digits normalised) to
  appear in `facts`, caps the length, and rejects URLs. If phrasing fails,
  times out or fails the check, the fixed fallback sentence for that intent is
  sent.
- **Fallbacks** follow the shop's country (`merchant_settings.country`,
  Bangladesh when there is no row): a `country → language` map (BD → `bn`,
  others → `en`) picks from `Record<language, Record<ReplyKind, string>>`; a
  missing sentence fails typecheck; there is no runtime fallback. The hand-off message is always the fixed
  fallback, with no LLM call.
- **Hand-off** (state `handed_off`, fixed reply) when the LLM errors or times
  out, the output fails Zod, confidence is below 0.6, the intent is `complain`
  or `request_human`, or the same slot was asked for three times in a row (a
  counter in `collected_slots`). The write sets `handed_off_at` together with
  `state = handed_off`; after it commits, call
  `NotificationsService.handedOff(merchantId, conversationId, handedOffAt)` so
  the seller is emailed if nobody replies in 10 minutes
  ([Settings – Notifications](../../10-settings-notifications/README.md#sending)).
- **All slots filled** → `awaiting_confirmation` and a phrased summary. No
  prices yet; phase 2 adds them to `facts`.
- **Shared send path:** the store-`sending` → `graph.sendText` →
  `markSent` / `markFailed` → publish sequence lives in `OutboundMessageSender`,
  used by `ConversationsService.send` and the assistant, with `sender` as a parameter.
  The 24-hour window check stays.
- **Ingest** (`ingest/inbound-message.ingest.ts`): return the locked
  conversation's `botPaused` and `state` from the transaction and queue the
  turn after `events.publish`, honouring the Page's `bot_enabled`. This and the
  hand-off email closed the Conversations follow-ups for queueing the turn and
  setting `handed_off_at`.
- **Shared:** a counter field on `collectedSlotsSchema`
  (`packages/shared/src/schemas/conversation.ts`) for repeated confusion. Any
  new enum member follows the three-file rule in `AGENTS.md`.

## Decisions

- **The product stays the customer's words.** `collected_slots` holds
  `productText` and `variantText` until [phase 2](../phase-2-catalog-confirm-orders/README.md)
  matches them to catalog IDs. There is no variant slot until then.
- **`browse` and `other` ask the next slot.** `ask_question` hands off, because
  nothing yet answers delivery, payment or catalog questions from facts.
- **Extraction runs by state**, not only on `order` and `edit_order` intents.
- **The phone is strict.** `parseCustomerPhone` accepts only a number it can
  read, and the slot stores it as E.164.
- **Replies are capped at 500 graphemes.**
- **Fallback Bangla awaits a native-speaker review.** The sentences are in
  `assistant-fallbacks.ts`.
- **Job id `turn-<metaMessageId>`.** BullMQ refuses `:` in a custom id. Queue
  `assistant-turns`, delay 2500 ms, concurrency 4.
- **A retried turn resumes an unfinished hand-off.** If the first run failed
  after its write committed, the retry re-notifies the seller, or hands off
  after a failed send, instead of stopping. The failed-send hand-off runs under
  the conversation lock and skips a paused chat.
- **The assistant reply is stamped at least 1 ms after its trigger**, so clock
  skew cannot make the turn look unanswered and send twice.
- `OutboundMessageSender` takes the database: `deliver` opens its own short
  transaction, as `ConversationsService.send` did.
- With no LLM configured but a turn already queued, the turn hands off with the
  fixed reply (the "always a reply" rule).

## Meta / App Review

None new. `pages_messaging` is already requested.

## Rules it must keep

From the MVP [rules](../../../mvp/01-messenger-to-order/rules.md): when unsure,
hand off; if the LLM fails, the customer still gets a reply; never call the LLM
inside a transaction; every repository method takes `merchantId`; never log
tokens or message text.

## Operational note

An environment with `LLM_PROVIDER=anthropic` (the old default) now fails
validation at boot. Set it to `openai` in every local `.env` and in Parameter
Store before deploying.

## Follow-ups

- A sweep of assistant rows stuck in `sending`. A crash between the commit and
  Graph leaves one, and the retry treats the turn as answered.
- A native-speaker review of the Bangla fallback sentences.
- A turn is lost if Redis refuses the queue add after the ingest committed.
- `llm_call` has no `(merchant_id, conversation_id)` index yet.

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
- Manually (still to run by the maintainer), with a real `LLM_API_KEY`: a message to the dev Page gets an AI
  reply, the turn shows in Bull Board, and an `llm_call` row is written. With a
  bad key, the conversation goes to `handed_off` with the fallback reply.
- The backend skill no longer says `extractOrder()` is not built; the
  [04 · Conversations](../../04-conversations/README.md) status is updated.
