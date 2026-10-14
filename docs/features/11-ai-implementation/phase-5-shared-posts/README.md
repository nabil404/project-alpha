# 11.5 · Shared posts and ads

**Status:** built (Oct 2026). The two runs on the dev Page, and the capture of
real share payloads they depend on, are still to do
([Done when](#done-when), [progress](../progress.md)).

## Goal

A customer who shares one of the Page's posts or ads into Messenger ("how much
is this?") gets an answer about the right product. Sellers link their posts to
products once.

## Depends on

[Phase 2](../phase-2-catalog-confirm-orders/README.md) (matching) and
[phase 3](../phase-3-entry-points/README.md) (referrals and `ad_product`).

## Scope

Code resolves the product before the LLM runs, most exact first. A resolved
product becomes a fact; prices come from the catalog, never a caption.

1. **Referral** (`m.me/<page>?ref=…` or an ad): handled by phase 3.
2. **A post the seller linked**, in a new `product_post` table
   (`merchant_id`, `product_id`, `post_id`) with RLS. The product page lets the
   seller paste post URLs or pick from the Page's recent posts.
3. **The post's caption**, read with `GET /{post-id}?fields=message,permalink_url`
   and the Page token, goes to extraction for matching. Because the product is
   inferred, the assistant confirms it ("Do you mean the Jamdani Saree?") and
   stores the post-to-product link as a suggestion the seller can accept.
4. **Unresolved:** ask which product, then hand off.

- **Webhook.** Accept `share` and `fallback` attachments, so a shared post
  with no text starts a turn. The job gains `links[]`.
- **Security.** Only facebook.com, fb.me and m.me hosts are parsed. A short
  `share/p/` link gets one redirect hop with a timeout. No other URL is
  fetched (SSRF).
- **Capture first.** Share payloads are poorly documented, so record real ones
  on the dev Page before writing the parser.

## What is built

### Webhook and ingest

- **Parsing** (`parseLinks` in `messenger/webhook-payload.ts`). A `post`,
  `share` or `fallback` attachment gives a `SharedLink`
  (`{ url, title, postId }`), and so does a Facebook link typed into the
  words. `url` is kept only on Facebook's hosts; `postId` is the `payload.id`
  of a `post` attachment, kept whatever its link. At most five links, each
  once. A `fallback` with neither a link nor an id stays an `other`
  attachment, as in phase 4.
- **Payload shape.** Meta's `messages` reference documents
  `{ type: 'post', payload: { url, title, id } }` ("ID of the shared post")
  and a `fallback` with `url` and `title`; the parser reads those. `share` is
  read the same way for older clients. On the dev Page (Oct 14, 2026), a
  shared Page post arrived as a link only:
  `permalink.php?story_fbid=pfbid…&id=<a profile id, not the Page's>`, with
  no post id ([Follow-ups](#follow-ups)).
- **Job.** `CustomerMessageJob` gains `links?`; the worker's job schema
  accepts it.
- **Ingest.** A message with links and no words is stored as kind `share`
  (a new `MessageKind`), with the links in `details.links`. A message with
  words keeps kind `text` and stores its links beside them. A share is a
  burst message (2.5 s delay), so a customer who shares and then types
  "how much?" gets one answer.

### Links (`messenger/posts/post-links.ts`)

- `allowedUrl` accepts http(s) on `facebook.com` and its subdomains, `fb.me`
  and `m.me`, with no credentials and no port. Anything else, `javascript:`
  and IP addresses included, is never parsed.
- `postRefOf` reads what a link names: a post by its id (`/<owner>/posts/<id>`,
  `permalink.php` and `story.php`, `photo`, `photos`, `videos`, `watch`,
  `reel`), a short link (`/share/…`, `fb.me`), or our own
  `m.me/<page>?ref=p_<id>` product link. Facebook names a post two ways: a
  number and a `pfbid…` id. `graphPostId` gives `<owner or Page>_<number>`
  for a number and `<Page>_<pfbid…>` for a pfbid; Graph answers the second
  with the post's numeric id and refuses the bare pfbid (error 12). Both
  checked in Graph API Explorer on the dev Page.
- `followShortLink` makes one `GET` with `redirect: 'manual'` and a 3 s
  timeout, and parses the `Location` without fetching it. A redirect to
  Facebook's log-in page is read from its `next`. A second short link,
  another host or any failure gives nothing.

### Turn

`SharedPostResolver` (`messenger/posts/shared-post.resolver.ts`) runs before
any LLM call, with no transaction open except its one short read:

| Resolution  | When                                                                                                                                                                                                      | Turn                                                                                                                                                                               |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `product`   | an `m.me` product link, or a `linked` `product_post` row matching the post's number or `pfbid…` id, directly or by the number Graph returns for the shared id (the row then keeps the pfbid as its alias) | a phase 3 product entry: `ref` (no LLM, the variant question) or, with words in the burst, `ref-typed` (the LLM on the words, the item already collected)                          |
| `suggested` | only a `suggested` row matches                                                                                                                                                                            | "Do you mean the X?" with X as a quick reply                                                                                                                                       |
| `caption`   | Graph read the post (`GET /{post-id}?fields=…`)                                                                                                                                                           | the caption is matched in code (`matchProduct`); one or up to three candidates as quick replies, and a single match is stored as a `suggested` row in the turn's write transaction |
| `unknown`   | no id Graph can read, Graph refuses (no `pages_read_engagement`, another Page's post), or no caption                                                                                                      | "Which product is it about? Please type its name." with `lastAsked.times = MAX_ASKS - 1`, so the next ask for that product hands off                                               |

- **The burst.** `shareIn` takes the newest share among the customer's
  messages since the last reply, so the share's turn and a "how much?" turn
  after it reach the same share; `typed` is whether the burst holds words of
  the customer's own beside the links.
- **Confirming an inferred product.** `decideSharedPost` offers the candidates
  for the item one past the end (`offered.item = items.length`) and fills
  nothing. Tapping one runs `applyPick`, which now appends that item, then the
  variant question follows. In `awaiting_confirmation` the card is retired
  with `revision + 1`, as any change does. At `MAX_ORDER_ITEMS` it hands off.
- The ask is a fixed sentence (`ask_product_shared_post`,
  `ask_product_shared_post_unknown` in both languages), never phrased.
- `decideNonText` returns null for a `share`, so a share is never pointed to
  Confirm and never confirms anything.

### Product posts (API)

`ProductPostsModule` (`messenger/posts/`), behind the session and
`TenantGuard`:

| Route                                   | Behaviour                                                                                                                                                                                                                   |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /products/:productId/posts`        | `{ data }`: the product's linked and suggested posts, newest first                                                                                                                                                          |
| `POST /products/:productId/posts`       | `{ url }` (pasted; a short link is followed one hop, and the caption read from Graph when it can) or `{ pagePostId }` (from the picker, read again from Graph). A suggested row for any product becomes this product's link |
| `PATCH /products/:productId/posts/:id`  | `{ status: 'linked' }` accepts a suggestion                                                                                                                                                                                 |
| `DELETE /products/:productId/posts/:id` | Unlinks, or dismisses a suggestion                                                                                                                                                                                          |
| `GET /messenger/page-posts`             | `{ data }`: the Page's 25 newest posts (`/{page-id}/published_posts`), each with the product it is linked to                                                                                                                |

Errors, as the routes' `@ApiCodedError` decorators declare them
(`product-posts.controller.ts`):

| Route                                    | Status | Code                                               | When                                                                                                  |
| ---------------------------------------- | ------ | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| every `/products/:productId/posts` route | 400    | `VALIDATION_FAILED`                                | A non-UUID id, or a body that is neither `{ url }` nor `{ pagePostId }` (`<digits>_<digits>`)         |
| `POST`                                   | 400    | `PRODUCT_POST_INVALID_URL`                         | Not a post on Facebook's hosts, a short link that led nowhere, or another Page's `pagePostId`         |
| `GET`, `POST`, `PATCH`                   | 404    | `PRODUCT_NOT_FOUND`                                | The product is not this shop's                                                                        |
| `PATCH`, `DELETE`                        | 404    | `PRODUCT_POST_NOT_FOUND`                           | No such post on this product                                                                          |
| `POST`, `PATCH`                          | 409    | `PRODUCT_POST_TAKEN`                               | The post is linked to another product (`{ productId, productName }`)                                  |
| `POST`, `PATCH`                          | 409    | `PRODUCT_POST_ARCHIVED`                            | The product is archived (`{ productId }`)                                                             |
| `POST`, `GET /messenger/page-posts`      | 409    | `MESSENGER_PAGE_NOT_CONNECTED`                     | A picked post, or the picker, with no Page connected                                                  |
| `POST`, `GET /messenger/page-posts`      | 409    | `FACEBOOK_PERMISSION_MISSING`                      | Graph refused (codes 10, 190, 200–299): reconnect to grant `pages_read_engagement` (`{ permission }`) |
| `POST`, `GET /messenger/page-posts`      | 503    | `MESSENGER_NOT_CONFIGURED`, `FACEBOOK_UNAVAILABLE` | No Messenger app configured, or Graph failed                                                          |

`PRODUCT_POST_*` and `FACEBOOK_PERMISSION_MISSING` are new `ErrorCode`s, with
entries in `error-keys.ts` and `errors.json`.

### Data

- **`0043_shared_posts`** (generated): the `product_post` table, and `share`
  added to `message_kind_ck` and `conversation_last_kind_ck`.
- **`0044_product_post_force_rls`** (`db:custom`): `FORCE ROW LEVEL SECURITY`.
- **`product_post`**: `merchant_id`, `product_id`, `post_id` (the id we were
  given first), `alias_id` (the other id, when known), `url`, `caption`,
  `status` (`linked` or `suggested`, with `product_post_status_ck`),
  `created_at`, `updated_at`. Unique on `(merchant_id, post_id)`; indexes on
  `(merchant_id, alias_id)` and `(merchant_id, product_id)`; the composite
  key `(merchant_id, product_id)` to `product` with `ON DELETE CASCADE`, so
  another shop's product is refused and deleting a product deletes its
  links. The isolation policy as every tenant table.

### Dashboard

- **Product page › Facebook posts** (`ProductPostsCard`): the assistant's
  suggestions with Accept and Dismiss, the linked posts with Unlink, a field
  to paste a post's link, and **Choose from your Page**, a dialog of the
  Page's newest posts with Link, or "Linked to X" for a post another product
  holds. Without a connected Page the picker is replaced by a note; pasting
  still works. A product that is not Published gets a note.
- **Conversation viewer.** A `share` shows "Shared a post" and each post's
  title, linked to Facebook when its link is https. The list and the
  customer card name the kind ("Shared a post") through `messageContent()`.

## Decisions

- **The caption is matched in code, not by the LLM.** The scope sends it to
  extraction; `matchProduct` on the caption does the same job with no LLM
  call, because a product name inside a longer text scores 1 when all its
  words are there. The customer confirms the match either way. Revisit if the
  dev Page's captions name products in ways the matcher misses.
- **A suggestion only for a single match.** Two or three candidates are
  offered, but no row is stored: the seller would not know which to accept.
- **A share wins over words in the same burst** unless it resolves to a
  linked product: "how much is this?" next to an unresolved post gets the
  "Do you mean…?" question, and the words stay in the history for later turns.
- **`pages_read_engagement` is optional at connect.** `PAGE_CONNECT_SCOPES`
  asks for it; `PAGE_REQUIRED_SCOPES` (the old three) decide whether a Page
  connects. If Meta refuses it, steps 1, 2 (pasted links) and 4 still work,
  as the scope asks.
- **Two ids per post.** Graph and old links give a number; shares and newer
  links give a `pfbid…` id. Graph's `permalink_url` is the numeric link, so
  linking a post (picked or pasted as a number) stores only the number. The
  first share of it is resolved through Graph (`<Page>_<pfbid…>` gives the
  number), and the row then keeps the pfbid as `alias_id`, so later shares
  match with no Graph call. A pasted pfbid link gets its number from Graph
  when it is linked. The first version assumed Graph returned both ids; the
  dev Page showed it does not, and shares of a linked post asked "which
  product?" until this was fixed.
- **A pasted link is linked even when Graph cannot read it.** Its caption is
  then empty; the link alone is enough to match a share by id.

## Meta / App Review

`pages_read_engagement`, to read posts and list the Page's recent ones. Added
as an optional scope in `meta-graph.client.ts`; connected Pages reconnect to
grant it. No new webhook field: shares arrive on `messages`.

**Review-date conflict.** Its screencast needs the post picker and caption
matching on the dev Page by the Week 4 submission (around Oct 18). Both are
built; the recording is still to be made.

## Rules it must keep

Prices only from the catalog. The customer confirms an inferred product
before it fills the slot. A shared post is never a confirmation. Only
Facebook's hosts are parsed and only a short link is fetched, once.

## Tests

- **`post-links.spec.ts`**: allowed hosts; `javascript:`, data URLs, IPv4,
  IPv6, the metadata address, lookalike hosts, credentials and ports refused;
  every link form read; one redirect followed, a second short link not
  fetched, a log-in redirect read from `next`, another host or an IP in
  `Location` refused, a timeout, and no fetch off the allowed hosts.
- **`webhook-payload.spec.ts`**: a `post` attachment with its id, `share` and
  `fallback` links, words with a pasted link, links off Facebook's hosts
  dropped, and a fallback with no payload kept as `other`.
- **`product-post.repository.spec.ts`** (DB): two-merchant isolation for
  list, find, match, relink, delete and suggest; another shop's product
  refused by the key; links deleted with their product; a suggestion never
  overwrites a row.
- **`product-posts.e2e.spec.ts`** (DB, HTTP): the error table above, a short
  link followed, a caption and `pfbid…` alias read from Graph, the picker
  with its "linked to" product, accept and remove, and isolation.
- **`assistant-turn.service.spec.ts`** (DB): a linked post resolves with no
  LLM call and asks for the variant, by its number or its `pfbid…` id; words
  with a linked post run the LLM with the item collected; an unlinked post's
  caption gives "Do you mean…?", stores a suggestion, and a tap fills the
  item with no LLM call; an unreadable post asks which product and the next
  failed ask hands off.
- **`inbound-message.ingest.spec.ts`** (DB): a share stored as kind `share`
  with its links and a turn queued; a pasted link kept beside the words.
- **`non-text-turn.spec.ts`**: a share is never pointed to Confirm.
- **`facebook-page.service.spec.ts`**: a Page connects without
  `pages_read_engagement`.
- `apps/web` has no test runner; the card and the viewer are covered by
  `typecheck` and `lint` only.

## Follow-ups

- **Capture more payloads** on the dev Page: an ad, a reel, and a share from
  the Messenger app rather than the web. A Page post shared from Facebook is
  known (a pfbid permalink link). Whether a `post` attachment with
  `payload.id` ever arrives, and in which shape, is unchecked.
- Open the Facebook posts card and a shared post in the viewer in a browser,
  including at 375 px. Not done in this change.
- A shared **reel** (`reel_video_id`) is still `other`; reading it needs the
  video's description from Graph.
- An ad's `referral.ads_context_data.post_id` could map an unmapped ad through
  `product_post`; phase 3's `ad_product` is the only mapping today.
- A suggestion with two or three candidates is not stored; once the customer
  picks one, that pick could become the suggestion.
- A native-speaker review of the two Bangla lines in `assistant-fallbacks.ts`.

## Done when

- [x] `pnpm --filter @app/shared build && pnpm typecheck && pnpm lint && pnpm test`
      pass (last run Oct 15, 2026), the new suites ran against the database,
      and `db:verify-rls` passes after migrations `0043` and `0044`.
- [ ] Sharing a linked post into the dev Page's chat starts the variant
      question for that product.
- [ ] Sharing an unlinked post produces a "Do you mean …?" question and a
      suggestion the seller can accept.
