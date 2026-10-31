# 11.1 · Foundation: the assistant's turn

**Status:** built (Oct 2026). The manual run on the dev Page is still to do
([Done when](#done-when), [progress](../progress.md)).

## Goal

A customer's text message gets an AI reply, start to finish: inbound message,
then an assistant-turn job, the LLM outside any transaction, a deterministic
state machine, and a reply through Graph. Any failure hands the conversation
to the seller with a fixed reply, so the customer always gets an answer.

Catalog matching, the Confirm button and orders are
[phase 2](../phase-2-catalog-confirm-orders/README.md), which also changed
some of what this page describes; notes say where.

## Depends on

Nothing. Inbound messages, the 24-hour window and seller sends already
existed ([04 · Conversations](../../04-conversations/README.md)).

## Flow

[Turn flow](turn-flow.md) draws it as a sequence diagram.

1. **Queue.** After committing a customer message, the ingest queues an
   `assistant-turn` job when the chat is not `bot_paused` or `handed_off`,
   the Page's `bot_enabled` is on, and both `LLM_API_KEY` and `META_APP_ID`
   are set. On a `confirmed` chat only a Confirm tap queues a turn. The job id
   is `turn-<metaMessageId>` and the delay 2.5 s, so a burst gets one turn.
2. **Read** (`withMerchant`): the conversation, the last 20 messages, the
   Page token and the shop's country. The turn stops if the chat is paused,
   `handed_off` or `confirmed`, if the trigger is no longer the latest
   customer message, or if `turn-gate` finds an assistant reply already
   after it.
3. **LLM**, no transaction open: `classifyIntent` on the routing model, then
   `extractOrder` on the extraction model when `shouldExtract` allows. That is
   every intent except `complain` and `request_human` while
   `collecting_details` or `awaiting_confirmation`, and only `order` or
   `edit_order` while `browsing`.
4. **Decide.** `decideTurn` in `conversation-machine.ts` is pure.
5. **Write**, in a short transaction: lock the conversation, write the
   `llm_call` rows, repeat step 2's checks plus the 24-hour window, then
   write `state` and `collected_slots` and insert the reply as `sending`. A
   failed re-check keeps only the `llm_call` rows.
6. **Send** through Graph after commit, mark it `sent` or `failed`, and
   publish the conversation event. A failed send hands off.

## Scope

- **Dependencies** (`apps/api`): `ai` 7.x, `@ai-sdk/openai` and `langsmith`.
- **Config** (`src/modules/config/env.schema.ts`, set up as in
  [LLM setup](../../../setup/llm-setup.md)):

  | Variable               | Default             | Notes                                                     |
  | ---------------------- | ------------------- | --------------------------------------------------------- |
  | `LLM_PROVIDER`         | `openai`            | The only value accepted                                   |
  | `LLM_MODEL_ROUTING`    | `gpt-6-luna`        | OpenAI's efficient tier: intent and phrasing              |
  | `LLM_MODEL_EXTRACTION` | `gpt-6.1-sol`       | The mid tier: extraction                                  |
  | `LLM_TIMEOUT_MS`       | `15000`             | An `AbortSignal.timeout` on each call                     |
  | `LLM_API_KEY`          | none                | Without it no turn is queued. `*.apiKey` is pino-redacted |
  | `LLM_INTENT_PROVIDER`  | `openai`            | `jev` classifies intent with TypeSafe's Jev instead       |
  | `TYPESAFE_API_KEY`     | none                | Required when `LLM_INTENT_PROVIDER=jev`                   |
  | `LANGSMITH_API_KEY`    | none                | Traces every call to LangSmith. Dev and stage only        |
  | `LANGSMITH_PROJECT`    | `social-glider-dev` | The LangSmith project                                     |
  | `LANGSMITH_ENDPOINT`   | US API              | The EU region's URL for an EU workspace                   |

- **`src/modules/llm/`**: `LlmClient` with `classifyIntent(history)`,
  `extractOrder(history, slots)` and `phraseReply(request, history)`,
  validated by `intentResultSchema` and `extractedOrderSchema` from
  `packages/shared/src/schemas/llm.ts`. It never throws: it returns
  `{ ok: true, value, usage }` or `{ ok: false, reason, usage }`, with the
  billed tokens on a failure too when the provider reported them. Message
  text is never logged. Provider token `LLM`, so tests inject a fake; one
  prompt file per call in `prompts/`.
- **Tracing.** With `LANGSMITH_API_KEY` set, `LlmModule` passes
  `LangSmithTelemetry` to every `generateText` call, named by its purpose.
  Without it, each call sets `isEnabled: false`, so a globally registered
  integration sees nothing either. Traces hold the full chat, so the key is
  never set in production ([LLM setup](../../../setup/llm-setup.md#tracing-with-langsmith)).
- **Cost tracking.** `llm_call` (`schema/assistant.ts`): `merchant_id`,
  `conversation_id`, `purpose` (`classify`, `extract`, `phrase`), `model`,
  input and output tokens, `latency_ms`, `outcome` (`ok`, `timeout`,
  `provider_error`, `invalid_output`), `prompt_pack` (the region's
  `PromptPack.id`, migration `0036_llm_call_prompt_pack`), `created_at`. RLS forced (migrations
  `0031_llm_call`, `0032_imports_force_rls`). Rows are written in step 5's transaction.
- **Queue** (`src/modules/queue/queue.constants.ts`): `assistant-turns`, job
  `assistant-turn`, concurrency 4, shown in Bull Board.
- **`src/modules/conversations/assistant/`**: `assistant-turn.processor.ts`
  (name check, Zod parse, `UnrecoverableError`, like
  `InboundMessageProcessor`), `assistant-turn.service.ts`,
  `conversation-machine.ts`, `reply-intent.ts`, `reply-check.ts`,
  `assistant-fallbacks.ts` and `assistant.module.ts`, imported by
  `src/worker.module.ts`.
- **Code decides, the LLM phrases.** `decideTurn` returns a typed intent, not
  text: `ask_slot`, `summary` or `handoff`. Phase 1 asked product, quantity,
  name, phone, address; phase 2 added `variant` after product.
  `phraseReply` (routing model) writes the intent in the customer's language,
  in the tone the seller picked, falling back to the seller's default
  language when the customer's is unclear
  ([Settings – Order assistant](../../12-settings-assistant/README.md)). `checkReply(text, facts)` then requires every number in the reply
  (prices, quantities, phone digits, Bangla digits normalised) to appear in
  `facts`, caps it at 500 graphemes, and rejects URLs. If phrasing fails,
  times out or fails the check, the intent's fixed sentence goes instead.
- **Fallbacks** follow `merchant_settings.country` (Bangladesh without a
  row): `BD` gives `bn`, any other country `en`. Each language has a sentence
  for every `FallbackKey` (`ask_<slot>`, `ask_phone_invalid`, `summary`,
  `handoff`, `handoff_awaiting_seller`, and phase 2's reasons). A missing
  sentence fails typecheck. The hand-off message is always the fixed
  sentence, with no LLM call.
- **Hand-off** (`handed_off`, fixed reply) when the LLM errors or times out,
  the output fails Zod, confidence is below 0.6 (`CONFIDENCE_FLOOR`), the
  intent is `complain` or `request_human`, or one slot was asked three times
  in a row (`MAX_ASKS`, counted in `collected_slots`). Before any item is in
  the cart, a `browse` or `other` turn (a greeting, a look around) asks again
  without counting, so chatting never reads as confusion. The write sets
  `handed_off_at` and `handoff_reason`; after commit,
  `NotificationsService.handedOff(merchantId, conversationId, handedOffAt)`
  emails the seller if nobody replies in 10 minutes
  ([Notifications](../../10-settings-notifications/README.md#sending)).
- **All slots filled** moves to `awaiting_confirmation` with a summary. There,
  a turn that changes no slot (a bare "yes") hands off as `awaiting_seller`
  with its own sentence ("The shop will confirm your order shortly"); a turn
  that changes a slot sends a new summary. Phase 2 replaced the phrased
  summary with the code-built card.
- **Empty extractions skip the confidence floor.** When every extracted field
  is null, `decideTurn` ignores its confidence (the prompt asks for 1 then). A
  filled field below 0.6 still hands off.
- **Hand back clears the counter** (`lastAsked`) in
  `ConversationsService.update`.
- **A customer back after 10 days starts over.** When the shop's last
  message came `STALE_CHAT_DAYS` (10) or more before the trigger, `startOver`
  empties the slots (cart, details and ask count), bumps `revision` so an old
  summary card is refused, and the turn runs as `browsing` on only the
  messages after that reply, so the old cart is not extracted again.
- **One send path.** `OutboundMessageSender` does store-`sending`, then
  `graph.sendText`, then `markSent` or `markFailed`, then publish, for both
  `ConversationsService.send` and the assistant, with `sender` as a
  parameter. It opens its own short transaction for `deliver`.
- **Ingest** (`conversations/ingest/inbound-message.ingest.ts`) returns the
  locked conversation's `botPaused` and `state` from its transaction and
  queues the turn after `events.publish`.

## Decisions

- **Extraction runs by state**, not only on `order` and `edit_order`, because
  a bare answer ("01812…", "Rahim") mid-flow is often classified `other`.
- **`browse` and `other` ask the next slot; `ask_question` hands off**, since
  nothing answers delivery, payment or catalog questions from facts yet.
- **The phone is strict.** `parseCustomerPhone` accepts only a number it can
  read and stores it as E.164.
- **Job id escaping.** `turn-<metaMessageId>` has `%` and `:` escaped
  (`queue/job-id.ts`), because BullMQ refuses `:` in a custom id.
- **A retried turn finishes an unfinished hand-off.** If the first run failed
  after its write committed, the retry re-notifies the seller, or hands off
  after a failed send, under the conversation lock and skipping a paused
  chat.
- **The reply is stamped at least 1 ms after its trigger**, so clock skew
  cannot make the turn look unanswered and send twice.
- **No LLM configured, but a turn already queued**: the turn hands off with
  the fixed reply.
- **The Bangla fallbacks await a native-speaker review**
  (`assistant-fallbacks.ts`).

## Meta / App Review

Nothing new; `pages_messaging` is already requested.

## Rules it must keep

From the MVP [rules](../../../mvp/01-messenger-to-order/rules.md): hand off
when unsure; reply even when the LLM fails; never call the LLM inside a
transaction; every repository method takes `merchantId`; never log tokens or
message text.

## Operational note

`LLM_PROVIDER=anthropic`, the old default, now fails validation at boot. Set
`openai` in every local `.env` and in Parameter Store before deploying, and
update or unset `LLM_MODEL_ROUTING` and `LLM_MODEL_EXTRACTION` in both places:
old Claude model ids would make every call fail and every turn hand off.

## Follow-ups

- Sweep assistant rows stuck in `sending`. A crash between commit and Graph
  leaves one, and the retry treats the turn as answered.
- A turn whose retries run out ends with no reply and no hand-off; the
  processor needs a `failed` handler that hands off.
- A customer message ingested just after a reply commits, but sent before it,
  is treated as answered. Its text is still in the next turn's history.
- A turn is lost if Redis refuses the queue add after the ingest committed.
- `llm_call` has no `(merchant_id, conversation_id)` index.
- A native-speaker review of the Bangla fallbacks.
- LangSmith runs carry no conversation id, so one turn's three calls are
  separate traces rather than one tree.

## Tests

In `conversations/assistant/__tests__/` unless noted.

- `conversation-machine.spec.ts`: every state × intent; null never overwrites
  a slot; the repeated-confusion hand-off, and greetings or browsing before
  any item never counting toward it; `startOver`; all slots filled →
  `awaiting_confirmation`.
- `turn-gate.spec.ts`: `staleReply` measures from the shop's last message,
  past the customer's own burst.
- `assistant-turn.service.spec.ts`: a customer back after `STALE_CHAT_DAYS`
  gets a fresh order, and the LLM sees only the new messages.
- `reply-check.spec.ts`: an invented price or quantity is rejected in Latin
  and Bangla digits; allowed facts pass; URLs and long replies are rejected.
- `llm/__tests__/llm.client.spec.ts`: the AI SDK's mock model; timeout,
  invalid JSON and provider errors give `ok: false`; each call reaches the
  telemetry integration under its purpose, and none does without one.
- `llm/__tests__/jev-intent.classifier.spec.ts`: Jev's state and question;
  the chosen intent's probability is the confidence; timeout and provider
  errors give `ok: false`.
- `assistant-turn.service.spec.ts`: an LLM failure hands off with a reply; a
  paused chat or stale trigger makes no LLM call; a takeover mid-turn is
  caught by the step 5 re-check; a Graph failure gives `failed` and
  `handed_off`; a phrasing failure sends the fallback.
- `ingest/__tests__/inbound-message.ingest.spec.ts`: queues only for an
  unpaused customer message on an enabled Page; a duplicate queues nothing.
- `llm-call.repository.spec.ts`: two-merchant isolation.
- `turn-gate.spec.ts` and `assistant-turn.processor.spec.ts`: the "already
  answered" check and the processor's job parsing.

## Done when

- [x] `pnpm --filter @app/shared build && pnpm typecheck && pnpm lint && pnpm test`
      pass (last run Oct 13, 2026).
- [x] Schema loop: `db:generate`, review, `db:custom` for `FORCE`,
      `db:migrate`, `db:verify-rls`.
- [ ] Manually, with a real `LLM_API_KEY`: a message to the dev Page gets an
      AI reply, the turn shows in Bull Board, and an `llm_call` row is
      written. With a bad key, the conversation goes to `handed_off` with the
      fallback reply.
- [x] The backend skill describes `extractOrder()` as built, and the
      [Conversations](../../04-conversations/README.md) status is updated.
