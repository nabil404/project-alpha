# 11.8 · Live-sale comments

**Status:** not started.

## Goal

During a Facebook Live sale, buyers comment order codes ("JD-RED 2", "code 12
x2"). Each buyer gets a private reply that starts the order with the right
product, variant and quantity already filled, fast enough to keep up with a
busy Live.

## Depends on

[Phase 7](../phase-7-comments-to-messenger/README.md): the comment webhook,
private replies and rate limits.

## Scope

- **Codes.** A product's variant SKUs work as codes; the seller can also add
  short Live codes ("12") to variants for one Live. Codes are unique per seller.
- **Parse in code first.** A regex for `<code> [x]<qty>` in Latin and Bangla
  digits; only unparseable comments go to the routing model. Most comments cost
  no LLM call.
- **Private reply** with the matched variant and quantity and the next missing
  slot (name, phone, address); stock is checked but not reserved until Confirm.
- **Dedupe per commenter per Live.** Several comments from one buyer add to the
  same conversation instead of starting new ones; a repeated comment does not
  double the quantity.
- **Live session view.** A dashboard page for a running Live: comments, matched
  codes, conversations started, confirmed orders, unmatched codes.
- **Volume.** A k6 test in `apps/api/load/tests/` replays a burst of comment
  webhooks (for example 50 a second for 5 minutes) and checks queue latency and
  that no reply is sent twice.

## Meta / App Review

As phase 7 (`feed`, `pages_read_user_content`, `pages_manage_engagement`). Check
how Live video comments arrive (the `feed` webhook or the `live_videos` field
plus polling) on the dev Page before building.

## Rules it must keep

A comment never confirms an order; the buyer confirms in Messenger. Stock and
price only from the catalog. Webhooks deduplicated.

## Tests

- Code parsing: "JD-RED 2", "jd-red x2", "১২ ২" (Bangla digits), and noise.
- The same buyer commenting three times → one conversation.
- An unknown code → fixed reply asking for the code again, no LLM call.
- Load test passes with no duplicate replies.

## Done when

- A test Live on the dev Page with several accounts commenting codes produces
  one conversation per buyer with the right variants, and the k6 test passes.
