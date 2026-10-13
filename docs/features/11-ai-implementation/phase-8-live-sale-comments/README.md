# 11.8 · Live-sale comments

**Status:** not started ([progress](../progress.md)).

## Goal

During a Facebook Live sale, buyers comment order codes ("JD-RED 2", "code 12
x2"). Each buyer gets a private reply that starts the order with product,
variant and quantity filled, fast enough for a busy Live.

## Depends on

[Phase 7](../phase-7-comments-to-messenger/README.md): the comment webhook,
private replies and rate limits.

## Scope

- **Codes.** Variant SKUs work as codes; they are already unique per merchant
  among live variants and stored upper-case, so matching ignores case. The
  seller can also give variants short Live codes ("12") for one Live, unique
  per seller.
- **Parse in code first.** A regex for `<code> [x]<qty>` in Latin and Bangla
  digits; only unparseable comments reach the routing model, so most cost no
  LLM call.
- **Private reply** with the matched variant and quantity and the next
  missing detail (name, phone, address). Stock is checked, not reserved: as
  for every order, it moves when the seller confirms the order
  ([Orders](../../07-orders/README.md#rules)).
- **One conversation per buyer per Live.** Further comments add to it; a
  repeated comment does not double the quantity.
- **Live session view.** A dashboard page for a running Live: comments,
  matched codes, conversations started, confirmed orders, unmatched codes.
- **Volume.** A k6 test in `apps/api/load/tests/`, next to
  `messenger-webhook.k6.js`, replays a burst of comment webhooks (say 50 a
  second for 5 minutes) and checks queue latency and that no reply goes
  twice.

## Meta / App Review

As phase 7. Before building, check on the dev Page how Live comments arrive:
the `feed` webhook, or the `live_videos` field plus polling.

## Rules it must keep

A comment never confirms an order; the buyer confirms in Messenger. Stock
and price only from the catalog. Webhooks deduplicated.

## Tests

- Code parsing: "JD-RED 2", "jd-red x2", "১২ ২" (Bangla digits), and noise.
- One buyer commenting three times gets one conversation.
- An unknown code gets a fixed reply asking again, with no LLM call.
- The load test passes with no duplicate replies.

## Done when

- [ ] A test Live on the dev Page with several accounts commenting codes
      produces one conversation per buyer with the right variants, and the k6
      test passes.
