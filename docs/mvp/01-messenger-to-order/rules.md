# Rules

These bind every change, backend and frontend alike.

## Non-negotiable rules

- No order is ever created without explicit customer confirmation (Confirm button on the summary card).
- The AI only quotes prices, variants, stock, and delivery charges from the seller's catalog. It never invents discounts or availability.
- When unsure (low confidence, repeated confusion, complaints, human request), hand off to the seller instead of guessing.
- If the LLM fails or times out, hand off gracefully. The customer is never left without a reply.
- Order creation is idempotent: the same confirmation never creates two orders.
- Each seller can only ever see their own Pages, catalog, conversations, and orders.
- Page access tokens and secrets are encrypted at rest and never logged.
- Every Meta webhook request is signature-verified and deduplicated.

Backend enforcement of these:
[`backend-engineer`](../../../.claude/skills/backend-engineer/SKILL.md)
§"The non-negotiable invariants".

## Database rules

- Never call the LLM (or any slow external API) inside a database transaction. Read state, call the LLM outside, then open a short transaction that locks the row, re-checks state, and writes.
- Inside a transaction, always use the transaction object. Repository methods take an executor parameter (`Executor`, i.e. `Database | Transaction`) instead of using this.db.
- Every repository method that touches business data takes merchantId and filters by it. Tests with two merchants verify one can never read, update, or confirm the other's data.
- Postgres lock_timeout and idle_in_transaction_session_timeout are set. BullMQ worker concurrency stays at or below the worker's pool size.
- jsonb columns are parsed with Zod on read. Counts and bigint values are converted from strings explicitly.

Worked examples, the executor pattern, and the two-merchant test shape:
[`backend-engineer`](../../../.claude/skills/backend-engineer/SKILL.md)
§"⚠️ Tenancy" and §"Database: Drizzle".
