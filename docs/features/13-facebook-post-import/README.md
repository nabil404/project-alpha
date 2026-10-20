# 13 · Import products from Facebook posts

A seller whose Page already has many product posts turns them into draft
products, so they don't type an existing catalog in by hand.

**Status (Oct 2026):** in [MVP 01's scope](../../mvp/01-messenger-to-order/scope.md).
The API and the worker are built: the routes below, the run, the LLM call,
empty price and stock in the catalog, and the finished email. The dashboard
screens are not ([Not yet built](#not-yet-built)). Screens: the "Catalog –
Import from Facebook posts (proposal)" row of the design canvas.

## At a glance

| Concern       | Decision                                                                                                                                           |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trigger       | On demand. The seller picks a date range and starts a run. No sync runs in the background                                                          |
| Range         | Default the last 3 months. At most 1 year per run; older posts take another run                                                                    |
| Source        | The connected Page's published posts, read with the Page token (`pages_read_engagement`)                                                           |
| Reading posts | One LLM call per post reads the caption and photos and returns zero or more products                                                               |
| Result        | Draft products only. The assistant never offers a draft, so nothing goes live until the seller activates it                                        |
| Photos        | Copied into R2 as normal product photos, because Facebook's photo URLs expire                                                                      |
| Repeats       | A post an earlier run handled is skipped. A product already in the catalog is skipped. A repost within one run is merged into the draft it repeats |
| Language      | The name stays as the seller wrote it. Other-language and transliterated names go into `aliases`                                                   |
| Categories    | An existing category is linked. A new one is only suggested, and the seller creates it                                                             |
| Empty fields  | A draft or archived product may have no price or stock. Only an active product needs both                                                          |
| Runs          | One running run per shop. A run can be stopped and resumed. Every run stays in the history. An email reports a finished run, behind its own switch |
| Cost          | About 1 US cent per post read, so about $1.50 for the default 3 months and up to about $7 for a year ([Cost](#cost))                               |

## The flow

1. **Choose a source.** Catalog's **Import** button opens "Import products"
   with two choices: **Import from Facebook**, and **Import from CSV**,
   disabled and marked "Coming soon" until
   [CSV import](../02-catalog/README.md#not-yet-built) is built.
2. **Choose dates.** The dialog names the connected Page and offers Last
   month, Last 3 months (selected), Last 6 months, Last year or custom dates.
   It says posts already imported are skipped and that the run can be left
   running. **Start import** creates the run and opens its page.
3. **Running.** `/catalog/imports/:id` shows "Reading post 34 of 84", a
   progress bar, four counts (drafts so far, not products, repeats merged,
   imported before) and the latest posts with what happened to each. **Stop
   import** stops after the current post.
4. **Finished.** The same page shows the run's counts and three tabs:
   - **Needs info:** drafts missing a price or stock, each with
     "Needs price" or "Needs stock" tags and **Fill in**.
   - **Ready to activate:** drafts with a price for every variant. Posts
     don't give stock, so the seller types one starting stock for every
     variant and activates the selected drafts at once.
   - **Skipped posts:** posts with no product, and posts whose product is
     already in the catalog, each with the reason, **View post** and
     **Import anyway**.
5. **Fill in a draft.** The normal product edit page, breadcrumb Catalog ›
   Products, with a **From this Facebook post** panel: the caption, the
   photos, a link to the post, and what was read from it. A banner says
   "Some details are missing. Fill in the highlighted fields to activate this
   product." **Activate** stays disabled until every variant has a price and
   stock. A suggested new category shows **Create and add** and **Dismiss**.
6. **History.** Catalog › **Imports**, a tab beside Products and Categories,
   lists every run newest first ([Dashboard](#dashboard)).

## Routes (session + TenantGuard)

Under `/api/v1`, in
[`imports.controller.ts`](../../../apps/api/src/modules/imports/imports.controller.ts).
Every route resolves the shop from the session's active organization, never
from the request. A non-UUID `:id` or `:postId` is `400 VALIDATION_FAILED`.

| Route                                    | Request                                                      | Response                          | Errors                                                                                                                                                                               |
| ---------------------------------------- | ------------------------------------------------------------ | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /imports`                          | `{ source: 'facebook_posts', since, until }`, ISO dates      | 202 `ImportRun`                   | 400 `VALIDATION_FAILED`, 409 `MESSENGER_PAGE_NOT_CONNECTED`, 409 `FACEBOOK_PERMISSION_MISSING`, 409 `IMPORT_ALREADY_RUNNING`, 503 `IMPORT_NOT_AVAILABLE`, 503 `FACEBOOK_UNAVAILABLE` |
| `GET /imports/facebook/access`           | none                                                         | `{ pageConnected, canReadPosts }` | 503 `MESSENGER_NOT_CONFIGURED`, 503 `FACEBOOK_UNAVAILABLE`                                                                                                                           |
| `GET /imports`                           | `page`, `limit` (10, 25 or 50)                               | `{ data, total }`, newest first   | 400 `VALIDATION_FAILED`                                                                                                                                                              |
| `GET /imports/:id`                       | none                                                         | `ImportRun`                       | 400 `VALIDATION_FAILED`, 404 `IMPORT_NOT_FOUND`                                                                                                                                      |
| `GET /imports/:id/posts`                 | `result` (`needs_info`, `ready`, `skipped`), `page`, `limit` | `{ data, total }`                 | 400 `VALIDATION_FAILED`, 404 `IMPORT_NOT_FOUND`                                                                                                                                      |
| `POST /imports/:id/stop`                 | none                                                         | `ImportRun`                       | 400 `VALIDATION_FAILED`, 404 `IMPORT_NOT_FOUND`, 409 `IMPORT_NOT_RUNNING`                                                                                                            |
| `POST /imports/:id/resume`               | none                                                         | 202 `ImportRun`                   | 400 `VALIDATION_FAILED`, 404 `IMPORT_NOT_FOUND`, 409 `IMPORT_NOT_STOPPED`, 409 `IMPORT_ALREADY_RUNNING`                                                                              |
| `POST /imports/:id/posts/:postId/import` | none ("Import anyway")                                       | 202 `ImportPost`                  | 400 `VALIDATION_FAILED`, 404 `IMPORT_NOT_FOUND`, 404 `IMPORT_POST_NOT_FOUND`, 409 `IMPORT_POST_NOT_SKIPPED`, 503 `IMPORT_NOT_AVAILABLE`                                              |
| `POST /imports/:id/activate`             | `{ productIds, startingStock }`                              | `{ activated, failed }`           | 400 `VALIDATION_FAILED`, 404 `IMPORT_NOT_FOUND`                                                                                                                                      |

- **`since` and `until`** are dates in the shop's time zone. `until` is not
  after today, `since` is not after `until`, and the range is at most 366
  days. A breach is `VALIDATION_FAILED` with a field code on the date:
  `INVALID_FORMAT` for a date that is not a calendar day, `INVALID_VALUE` on
  `since` after `until`, `MAX_VALUE` (`{ max: 366 }`) on `since` for a longer
  range, and `MAX_VALUE` (`{ max: <today> }`) on `until` after the shop's
  today. `createImportSchema` holds all but the last, which needs the shop's
  zone.
- **`POST /imports` checks, in order,** that an LLM and the Graph client are
  configured (`IMPORT_NOT_AVAILABLE`), the dates, the connected Page, that no
  run is going, and one `published_posts` call. Graph refusing the token is
  `FACEBOOK_PERMISSION_MISSING`, Graph failing otherwise
  `FACEBOOK_UNAVAILABLE`. The unique index decides a race
  (`IMPORT_ALREADY_RUNNING`).
- **Try again** on a failed run is a new `POST /imports` with the same range,
  so a failed run stays as it was in the history.
- **`ImportRun`** (`importRunSchema` in
  [`imports.ts`](../../../packages/shared/src/schemas/imports.ts)): `id`,
  `source`, `since`, `until`, `status`, `errorCode`, `createdAt`,
  `startedAt`, `finishedAt`, `postsTotal` (null until the last page is read),
  `postsRead`, and the counts `drafts`, `merged`, `notProducts`, `inCatalog`,
  `alreadyImported`, `failed` and `leftToReview` (the run's products still in
  draft).
- **`ImportPost`**: the post's row id (the `:postId` of Import anyway),
  Graph's `postId`, `createdTime`, `caption`, `url`, `photoCount`, `result`,
  `reason`, `suggestedCategory`, `matchedProducts` (`{ id, name }`) and
  `products`: the drafts it made or merged into that still exist, each with
  `status`, `coverThumbnailUrl`, `variantCount`, `needsPrice` and
  `needsStock`. `needs_info` lists posts that made a draft still missing a
  price, `ready` posts whose drafts are priced throughout, each with only
  those drafts; `skipped` lists `not_product` and `in_catalog` posts. With no
  `result`, every post, latest handled first.
- **`POST /imports/:id/activate`** sets `startingStock` (0 to 1,000,000) on
  every live variant with no stock, then makes each product `active`, one
  product per transaction under the product lock. A product that is not this
  run's or no longer exists (`PRODUCT_NOT_FOUND`), is not a draft
  (`PRODUCT_NOT_DRAFT`), or still misses a price (`PRODUCT_PRICE_MISSING`)
  comes back in `failed` with that code, and the rest go ahead.
- **`GET /products?importId=`** filters the products list to one run's drafts,
  for "See them all in Products".
- New `ErrorCode`s: `IMPORT_NOT_FOUND`, `IMPORT_ALREADY_RUNNING`,
  `IMPORT_NOT_RUNNING`, `IMPORT_NOT_STOPPED`, `IMPORT_POST_NOT_FOUND`,
  `IMPORT_POST_NOT_SKIPPED`, `IMPORT_NOT_AVAILABLE`, `PRODUCT_PRICE_MISSING`,
  `PRODUCT_STOCK_MISSING` and `PRODUCT_NOT_DRAFT`, each with its
  `error-keys.ts` entry and `errors.json` string. The run status has
  `importRunStatusKeys` in `status-keys.ts` and `status.importRun` in
  `common.json`.

## Errors

From
[`import-errors.ts`](../../../apps/api/src/modules/imports/import-errors.ts),
plus the Page and catalog errors the table above names.

| Code                      | Status | Params   | When                                                                        |
| ------------------------- | ------ | -------- | --------------------------------------------------------------------------- |
| `IMPORT_NOT_FOUND`        | 404    | `{ id }` | No such run for this shop                                                   |
| `IMPORT_ALREADY_RUNNING`  | 409    | none     | The shop has a `queued`, `running` or `stopping` run                        |
| `IMPORT_NOT_RUNNING`      | 409    | `{ id }` | Stop on a run that is not `queued` or `running`                             |
| `IMPORT_NOT_STOPPED`      | 409    | `{ id }` | Resume on a run that is not `stopped`                                       |
| `IMPORT_POST_NOT_FOUND`   | 404    | `{ id }` | No such post row in the run                                                 |
| `IMPORT_POST_NOT_SKIPPED` | 409    | `{ id }` | Import anyway on a post that is not `not_product` or `in_catalog`           |
| `IMPORT_NOT_AVAILABLE`    | 503    | none     | No `LLM_API_KEY` or no Graph client (`META_APP_ID`), so no post can be read |

## Rules

### Reading posts

- **Graph call.** `GET /{page-id}/published_posts` with `since`, `until`,
  `limit=25` and
  `fields=id,message,created_time,permalink_url,attachments{media_type,media,subattachments.limit(20){media_type,media}}`,
  through `MetaGraphClient`, never inside a transaction. The post picker
  (`GET /messenger/page-posts`) reads the same edge with `full_picture` only
  (`POST_FIELDS` in `meta-graph.client.ts`), so reading every photo of an
  album through `attachments` and `subattachments` is new parsing code.
- **What Graph returns.** Meta returns about 600 ranked posts a year from a
  Page's feed, and Reels come from a separate edge. A run therefore reads
  what Graph gives, and the summary counts what it read, never "all posts".
  Reels are not imported.
- **Paging.** The run keeps the `after` cursor of the page it is reading, so
  a resumed or retried run reads that page again and skips its handled posts.
  Graph sends a cursor on the last page too; only `paging.next` says there is
  another. `postsTotal` is set when the last page arrives.
- **Range.** `since` is the start of that day in the shop's zone and `until`
  the start of the day after (`shopDayStart`), both as Unix seconds.
- **One post at a time.** Each post is skipped, read, or failed before the
  next starts, and the run's counts update after each.

### Turning a post into products

For each post, in order:

1. **Already imported.** The post is skipped as `already_imported`, with no
   LLM call, when a `product_post` row has its id or alias (any status), or
   an earlier run's `product_import_post` row for it has any result but
   `failed`. A post an earlier run marked `failed` is read again. This makes
   overlapping ranges safe and keeps a rerun from paying for the same posts
   twice.
2. **No caption and no photo** is skipped as `not_product`, with no LLM call.
3. **Photos.** Up to 8 of the post's photos are downloaded from Meta's URLs
   outside any transaction, with a size limit and a timeout, and re-encoded
   with `normalize-product-image`. Videos are not imported.
4. **The LLM call** (`extractProductsFromPost`, [below](#llm-call)) returns
   `not_product` with a reason, or up to 10 products.
5. **Already in the catalog.** Each product is matched by name
   (`matchProduct`, score 1) against the shop's `active`, `draft` and
   `archived` products from before this run. A match is left out: the import
   never changes or links a product the seller already has. When every
   product in the post matches, the post is skipped as `in_catalog`, listed
   under Skipped posts with "Already in your catalog" and the product's name,
   so the seller can check it there. `matchProduct` takes a `CatalogView`,
   which the assistant builds from sellable products only, so the import
   builds its own view with drafts and archived products in it.
6. **Repeats within the run.** A product that matches a draft this run made
   is `merged`: the post's new photos go to that draft, up to the 8-photo
   cap, and nothing else changes.
7. **Write.** One short transaction per post creates each new draft through
   `ProductWriter`, its photos as `product_image` rows, its category links,
   and the post's `product_import_post` row. It adds a `linked`
   `product_post` row only when the post gave exactly one product, new or
   merged. `product_post` is unique on `(merchant_id, post_id)`, and phase 5
   resolves a shared post to one product, so a post with several products is
   linked to none. Its import row alone keeps later runs from reading it
   again. Photo objects are uploaded before the transaction and land under
   `m/`. The orphan sweep leaves objects younger than 24 hours, so a failed
   write's objects are swept later.

**Import anyway** reads the post from Graph again for fresh photo links. On an
`in_catalog` post it makes drafts of every product in the stored `extracted`
output, with no LLM call and no catalog match. On a `not_product` post it
re-runs the LLM call with a hint that the post holds a product, and makes
drafts of what it reads; if the LLM still finds none, or fails, the post stays
as it was. Either way the run's counts move from the skip to `drafts`.

A post with several new products gives each draft its own copy of the
photos, because an image row belongs to one product. A post whose products
were cut to fit the catalog's limits keeps `reason: limits_applied`.

### What a draft holds

- **Name and description** from the caption, as written.
- **Aliases:** other ways customers write the name, so the assistant's
  matching finds it. The languages come from the shop's country, as the
  assistant's fallback language does: a shop in Bangladesh gets the name in
  Bangla and in English or Latin letters ("থ্রি পিস", "3 piece"), and a shop
  elsewhere gets English and, for a name in another script, Latin letters.
- **Options** (at most 3) and their values, from the caption or the photos,
  within the catalog's limits (30 values, 100 variants). Beyond a limit the
  draft keeps the first values and the post's `reason` is `limits_applied`.
- **Price** per variant only when the post states it, in the caption or
  written on a photo. "Inbox for price" leaves it empty. Prices are stored in
  minor units like every other price.
- **Stock** is always empty. Posts don't hold it.
- **SKU** is generated, as for a blank SKU.
- **Category:** an existing category the LLM names is linked. A new name is
  stored on the import row as a suggestion only.
- **Status:** `draft`.

### Empty price and stock

Today `product_variant.price` is required and `stock` is `NOT NULL DEFAULT 0`
(`schema/catalog.ts`). Both become nullable, for every product, not only
imported ones:

- **A `draft` or `archived` product may leave a variant's price or stock
  empty.** This holds for the import, the product form and the API alike. The
  service enforces it, because a check constraint cannot see the product's
  status. Existing rows keep their values.
- **An `active` product needs both** on every live variant. Every write that
  can make or keep a product active checks it: `POST /products`,
  `PUT /products/:id`, `PATCH /products/:id`,
  `PATCH /products/:id/variants/:variantId` and the import's activate route.
  A missing price is `PRODUCT_PRICE_MISSING` and a missing stock is
  `PRODUCT_STOCK_MISSING`, each with `{ variantId, name }`. A save that fills
  the gaps and activates in one write passes. The import's activate route
  fills stock from `startingStock` first.
- **Shared schemas.** `saveProductSchema` and the variant schemas accept
  `null` for `price` and `stock`. The form leaves an empty field `null`
  instead of `0`, and shows the API's field error when the status is active.
- **Archiving** keeps whatever the variants hold, empty or not. Bringing an
  archived product back to `active` runs the same check.
- **Selling.** `findSellableCatalog` reads `active` products only, so the
  assistant never sees an empty price. Orders and reservations touch only
  sellable variants. `available` (stock less reserved) is computed for
  active products only.
- **Lists.** The products list shows "—" for an empty price or stock, and the
  stock filters count an empty stock as out of stock.

### Runs

- **One at a time.** A shop with a `queued`, `running` or `stopping` run gets
  `IMPORT_ALREADY_RUNNING`.
- **Statuses:** `queued`, `running`, `stopping`, `stopped`, `finished` and
  `failed`. Stop sets `stopping`, and the worker stops after the current post.
- **Resume** re-queues a `stopped` run. Posts it already handled are found
  by `product_import_post`'s unique key and skipped.
- **Fails the run:** the Page is disconnected, or Graph refuses the token
  (codes 10, 190, 200–299), as `FACEBOOK_PERMISSION_MISSING`. Graph failing
  after the job's retries is `FACEBOOK_UNAVAILABLE`. Five LLM failures in a
  row is `IMPORT_NOT_AVAILABLE`. The run keeps the drafts it already made.
- **Fails one post only:** one LLM failure, an unreadable photo, or a write
  that loses a race. The post is `failed`, counted, and the run goes on.
- **Import anyway** is a small job on the same queue. It is allowed while
  another run is going.

### The finished email

A fourth switch in
[Settings – Notifications](../10-settings-notifications/README.md),
**Import finished**, on by default, per person and per shop like the other
three.

- **Reported by** `NotificationsService.importFinished(merchantId, importId)`
  when a run ends as `finished`, `stopped` or `failed`, with job id
  `import-finished-<importId>`. A resumed run that ends again sends again,
  with a job id carrying its end time.
- **Sent to** the shop's members with the switch on and a verified email,
  as `recipients` decides today.
- **Says** the range, how many drafts were made, how many need info, or why
  the run failed, and links to `/catalog/imports/:id`.
- **Changes:** `NotificationSettings` gains `importFinished` in
  `packages/shared/src/schemas/notifications.ts` and
  `NOTIFICATION_DEFAULTS`, the preferences table gains a column, the PATCH
  route accepts it, and `/settings/notifications` shows a fourth switch. The
  Settings – Notifications page and the canvas's Notifications screens are
  updated when it is built.

## LLM call

`extractProductsFromPost`, a fifth method on `LlmClient`, on
`LLM_MODEL_EXTRACTION` because it reads images. When it is built,
[ai.md](../../architecture/ai.md) gains its prompt, schema and path in the
same change.

- **Input:** the caption and up to 4 of the post's photos (our copies, as
  `file` parts with a URL), the shop's currency and country (for the alias
  languages), and the shop's category names. The caption and every name go
  through `asData`, and the system prompt ends with the data rule.
- **Output schema** (`postProductsSchema` in `packages/shared/src/schemas/llm.ts`):
  `{ kind: 'products' | 'not_product', reason, products: [{ name, description, aliases, options: [{ name, values }], prices: [{ values, price }] | null, category: { kind: 'existing' | 'suggested', name } | null }] }`.
  Every field is present, null where empty, which OpenAI's strict mode needs.
  Prices are numbers in major units as the post shows them, and code converts
  them. The prompt and the checks are in [ai.md](../../architecture/ai.md#extractproductsfrompost).
- **Code checks the output:** an `existing` category not in the list is
  dropped, a price that is not a positive number is dropped, option limits
  are applied, and a product with no name is dropped.
- **Failure** never throws, as every call. A failed post is `failed`, not a
  guess.
- **Recording.** Every call writes an `llm_call` row with a new purpose,
  `post_import`, added to `llm.types` and to the literal copy in
  `schema/assistant.ts`, which `llm-call.repository.spec` keeps equal, and
  to `llm_call_purpose_ck`. `llm_call.conversation_id` is `NOT NULL`, with a
  composite foreign key to `conversation` that cascades. The row therefore
  gets `conversation_id` nullable, an `import_id` with its own composite key
  `(merchant_id, import_id)` to `product_import` that also cascades, and a
  check that exactly one of the two is set.

### Cost

One call per post the LLM reads. Posts skipped before the call (already
imported, or empty) cost nothing. An estimate per post, at `gpt-6.1-sol`'s
list price of $2.00 per million input tokens and $10.00 per million output
tokens ([OpenAI pricing](https://developers.openai.com/api/docs/pricing),
checked Oct 21, 2026):

| Part                                   | Tokens (approximate) | Cost (US$) |
| -------------------------------------- | -------------------- | ---------- |
| System prompt, caption, category names | 1,100 in             | 0.0022     |
| 4 photos at `imageDetail: 'auto'`      | 3,000 in             | 0.0060     |
| Output: one or two products            | 350 out              | 0.0035     |
| **Per post**                           | **4,450**            | **0.012**  |

| Run                              | Posts read | Cost (US$) |
| -------------------------------- | ---------- | ---------- |
| Last month                       | about 50   | about 0.60 |
| Last 3 months (the default)      | about 150  | about 1.80 |
| Last year (the most a run reads) | about 600  | about 7.00 |

- **The photo tokens are a guess.** OpenAI's pricing page does not say how
  this model counts an image. The 750 tokens a photo assumes the usual tiles
  for a photo about 1,000 pixels wide. Sending photos at `'low'` (about 85
  tokens each) would bring a post to about half a cent, but may miss prices
  written small on a photo.
- **The cached system prompt** costs $0.10 per million, so a run's repeated
  prompt is almost free after the first call. The table does not count that
  saving.
- **The first runs on the dev Page** give the real number: `llm_call` holds
  each call's tokens, and a run's cost is their sum.

## Data model

[`schema/imports.ts`](../../../apps/api/src/modules/database/schema/imports.ts),
migration `0049_product_import`. Both tables carry `merchant_id`, the
isolation policy, and `FORCE ROW LEVEL SECURITY` (migration
`0050_product_import_force_rls`), and pass `db:verify-rls`.

| Table                 | Key columns                                                                                                                                                                                                                                                                                                                             | Constraints                                                                                                                                                                                                            |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `product_import`      | `id`, `source` (`facebook_posts`), `since`, `until` (`date`), `status`, `error_code`, `started_by` (user, `SET NULL`), `cursor`, `posts_total`, `posts_read`, `drafts`, `merged`, `not_products`, `in_catalog`, `already_imported`, `failed`, `llm_failures_in_row`, `created_at`, `started_at`, `finished_at`, `updated_at`            | Status and source checks; `since <= until`; a partial unique index on `merchant_id` where `status IN ('queued', 'running', 'stopping')` (`PRODUCT_IMPORT_ACTIVE_UIDX`), so two runs can't start                        |
| `product_import_post` | `import_id`, `post_id` (Graph's `<page>_<post>`), `created_time`, `caption`, `permalink_url`, `photo_count`, `result` (`draft`, `merged`, `not_product`, `in_catalog`, `already_imported`, `failed`), `reason`, `matched_product_ids text[]`, `suggested_category`, `product_ids text[]`, `extracted jsonb`, `created_at`, `updated_at` | Unique `(merchant_id, import_id, post_id)`; indexes on `(merchant_id, post_id)` for the skip check and `(merchant_id, import_id, created_at)` for the list; composite key to `product_import` with `ON DELETE CASCADE` |

- **`llm_failures_in_row`** counts the run's LLM failures since its last
  successful call; five fail the run.
- **`extracted`** is the checked LLM output, parsed with `postProductsSchema`
  on read, so Import anyway on an `in_catalog` post needs no second call.

- **Existing tables:** `product_post` gets a `linked` row for each post that
  gave exactly one product (`ProductPostRepository.linkIfFree`, which leaves
  a post that already has a row alone), which phase 5 then uses to answer
  shares of the post. Its key stays as it is. `product_variant.price` and
  `stock` are nullable, and `reserved <= coalesce(stock, 0)`
  ([Empty price and stock](#empty-price-and-stock)). `llm_call` has
  `import_id` ([LLM call](#llm-call)). `notification_preference` has
  `import_finished` ([The finished email](#the-finished-email)).
- **No column on `product`.** "From this Facebook post", "From import" and
  "Left to review" all join through `product_import_post.product_ids`.
- **Deleting a draft** cascades its `product_post` rows, but the post's
  import row stays, so a later run still skips the post. **Import anyway**
  from that run brings it back.

## Queue

A new `catalog-imports` queue (`IMPORTS_QUEUE`), consumed only by
`ImportsProcessor` in the worker at a concurrency of 2. Job `import-run`, id
`import-<runId>`, does a whole run (`ImportRunner.run`). Job `import-post`,
id `import-post-<runId>-<postId>`, does one Import anyway
(`ImportRunner.importAnyway`). Both are removed when they end, so a resume or
a second Import anyway can reuse the id; while one is queued or running, the
same id is a no-op. A run's job holds no transaction across Graph, Meta's
CDN, storage or LLM calls. Each post's write is one short `withMerchant`
transaction. A Graph or storage outage throws, so BullMQ retries the job from
the cursor; on the last attempt the run fails instead, with
`FACEBOOK_UNAVAILABLE` or `IMPORT_NOT_AVAILABLE`. Bull Board lists the queue
in development.

## Dashboard

- **Catalog › Import** opens the source modal ([The flow](#the-flow)).
- **`/catalog/imports`**, the **Imports** tab: a **Past imports** table with
  Posts from (the range), Ran on, Result (Finished, Running, Stopped or
  Failed, with a one-line reason), Posts read, Drafts, Left to review, and
  **Open**, **Resume** or **Try again**. The tab's main button is **Import
  from Facebook**.
- **`/catalog/imports/:id`**: the running view, then the summary, in one
  route. The breadcrumb is Catalog › Imports › the run's range. While the run
  is `queued`, `running` or `stopping` the page refetches `GET /imports/:id`
  every 3 seconds. It stops at any other status.
- **Product edit page:** the **From this Facebook post** panel when the
  product has a `product_import_post`, the missing-field banner, the
  highlighted empty price and stock fields, and the category suggestion. An
  empty price or stock is allowed while the status is Draft or Archived.
- **Products list:** a "From import" filter (`importId`) reached from the
  summary, and "—" for an empty price or stock.
- **Settings › Notifications:** the fourth switch, **Import finished**.
- Copy goes through `t()`, dates and money through `useFormatters()`.

## Meta / App Review

The import needs `pages_read_engagement`, which `PAGE_CONNECT_SCOPES` already
asks for but a Page may have connected without. `facebook_page` stores no
granted scopes, so the app asks Graph instead of recording them:
`GET /imports/facebook/access` makes one `published_posts` call with
`limit=1` and answers `{ pageConnected, canReadPosts }`. The date dialog
calls it when it opens. When `canReadPosts` is false, the dialog shows
"Reconnect your Page to allow reading posts" in place of **Start import**.
`POST /imports` makes the same check and answers
`FACEBOOK_PERMISSION_MISSING`. The permission's App Review description names
this use beside phase 5's post linking
([Meta requirements](../../mvp/01-messenger-to-order/meta-requirements.md)).

## Tests

| Spec                                                                                                                                                | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`imports/__tests__/post-drafts.spec.ts`](../../../apps/api/src/modules/imports/__tests__/post-drafts.spec.ts)                                      | Draft writing: names as written, aliases, option limits, prices per variant and from a photo, bad prices dropped, categories linked, dropped or suggested                                                                                                                                                                                                                                                                                                                                   |
| [`imports/__tests__/import.repository.spec.ts`](../../../apps/api/src/modules/imports/__tests__/import.repository.spec.ts) (DB)                     | Schema literals equal the shared enums; one going run per shop under a race; one row per post per run; the skip check; the summary tabs; two-merchant isolation on both tables                                                                                                                                                                                                                                                                                                              |
| [`imports/__tests__/import-runner.spec.ts`](../../../apps/api/src/modules/imports/__tests__/import-runner.spec.ts) (DB, Graph, CDN and LLM stubbed) | Paging and the cursor; photos, cover, category, link and `llm_call` of a draft; a linked post and an earlier run's posts skipped, its failed post read again; empty and not-product posts; in-catalog posts (active, draft, archived) left unchanged; one new and one known product; two products and no link; a repost merged; stop and resume; a stop before the job; token refused; a Graph outage and its last attempt; five LLM failures; an unreadable photo; Import anyway both ways |
| [`imports/__tests__/imports.e2e.spec.ts`](../../../apps/api/src/modules/imports/__tests__/imports.e2e.spec.ts)                                      | The routes over HTTP and their errors, the access check, another shop's runs, stop and resume, the tabs, Import anyway, activate and the products list's `importId`                                                                                                                                                                                                                                                                                                                         |
| [`products/__tests__/product-empty-price.service.spec.ts`](../../../apps/api/src/modules/products/__tests__/product-empty-price.service.spec.ts)    | Empty price and stock on draft and archived products; each write refusing an active product with either empty; archived back to active; the list; `findSellableCatalog`                                                                                                                                                                                                                                                                                                                     |
| [`notifications/__tests__/notification-composer.spec.ts`](../../../apps/api/src/modules/notifications/__tests__/notification-composer.spec.ts)      | The switch's default, a finished, a stopped and a failed run's email, and an end the run has moved on from                                                                                                                                                                                                                                                                                                                                                                                  |
| [`messenger/page/__tests__/meta-graph.client.spec.ts`](../../../apps/api/src/modules/messenger/page/__tests__/meta-graph.client.spec.ts)            | `listPublishedPosts`: album photos, videos left out, the cursor and the last page                                                                                                                                                                                                                                                                                                                                                                                                           |

`apps/web` has no test runner. The screens get `typecheck`, `lint` and a
check at 375 px when they are built.

## Key files

Under `apps/api/src/modules/` unless noted:

- [`imports/imports.service.ts`](../../../apps/api/src/modules/imports/imports.service.ts) and [`imports.controller.ts`](../../../apps/api/src/modules/imports/imports.controller.ts): the routes, in `ImportsModule`, which `AppModule` imports
- [`imports/import-runner.ts`](../../../apps/api/src/modules/imports/import-runner.ts), [`imports.processor.ts`](../../../apps/api/src/modules/imports/imports.processor.ts) and [`import-photos.ts`](../../../apps/api/src/modules/imports/import-photos.ts): the run, in `ImportsWorkerModule`, which only `WorkerModule` imports
- [`imports/post-drafts.ts`](../../../apps/api/src/modules/imports/post-drafts.ts): checking the LLM's output into drafts
- [`imports/import.repository.ts`](../../../apps/api/src/modules/imports/import.repository.ts): runs, posts, the skip check and the tabs
- [`llm/prompts/extract-products-from-post.ts`](../../../apps/api/src/modules/llm/prompts/extract-products-from-post.ts): the prompt
- [`messenger/page/meta-graph.client.ts`](../../../apps/api/src/modules/messenger/page/meta-graph.client.ts): `listPublishedPosts` and `getImportPost`
- [`packages/shared/src/schemas/imports.ts`](../../../packages/shared/src/schemas/imports.ts): the shared contract

## Not yet built

- **The dashboard**: the Import modal, the date dialog, `/catalog/imports`
  and `/catalog/imports/:id`, the product edit page's **From this Facebook
  post** panel, banner and category suggestion, the products list's "From
  import" filter, and the **Import finished** switch
  ([Settings – Notifications](../10-settings-notifications/README.md#follow-ups)).
- **A read for the From this Facebook post panel.** No route returns a
  product's import row yet; it joins through
  `product_import_post.product_ids`.
- **Empty fields on the product form**
  ([Catalog](../02-catalog/README.md#not-yet-built)).
- **The App Review description** of `pages_read_engagement` naming this use.

## Open questions

- **A cost cap.** A run costs about 1 cent a post and at most about $7, and
  one run per shop can go at a time. Whether a shop also gets a monthly limit
  on posts read is still open.

## Follow-ups

- **CSV import**, which enables the modal's second choice.
- **Reels and videos**, read from the Page's `video_reels` edge.
- **Import from a single post link**, for one product without a run.
