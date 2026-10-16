# 11.6 · Product photos

**Status:** built (Oct 2026). The run on the dev Page and its hit rate are
still to do ([Done when](#done-when), [progress](../progress.md)).

## Goal

A customer sends a photo or screenshot of a product ("do you have this?") and
the assistant finds candidates in the catalog. The customer always confirms
the match before it fills the product slot.

## Depends on

[Phase 2](../phase-2-catalog-confirm-orders/README.md) (matching and
quick-reply choices) and [phase 4](../phase-4-non-text-events/README.md)
(attachments stored with a `kind`).

## Scope

- **Input.** An `image` attachment. Download it from Meta's URL outside any
  transaction, with a size limit and timeout, and keep it in R2 so the seller
  can see it. Use a prefix other than `m/`: the orphan sweep deletes any
  object under `m/` without a `product_image` row
  ([Catalog](../../02-catalog/README.md#orphan-sweep)).
- **Candidates.** Send the image and a short list of the seller's active
  products (cover images and names, narrowed by category when the customer
  named one) to a vision model. Ask for at most three product ids from the
  list, with confidence, and discard any id not on it.
- **Confirm the match.** One candidate gets "Is it this one?" with its cover
  and Yes / No quick replies; several get a carousel; none or low confidence
  asks for the name, then hands off.
- **Screenshots** of another shop's post are treated as a product photo, and
  any price in them is ignored.
- **Cost.** Each vision call writes an `llm_call` row with purpose
  `vision_match`, which needs a new member in `LLM_CALL_PURPOSES` and a
  migration for `llm_call_purpose_ck`. A per-conversation cap (say three
  photos a turn) stops abuse.
- **Later, if accuracy falls short:** precomputed catalog image embeddings and
  a similarity search before the vision call.

## What is built

### Copying the photo

Meta's attachment links expire, so every customer photo is copied, whether or
not the assistant reads it (a handed-off or paused chat included):

1. After the ingest commits an `image` message from a customer, it queues
   `store-photo` on the `customer-photos` queue with job id
   `ph-<message id>` (`inbound-message.ingest.ts`). The worker runs two at
   a time (`CUSTOMER_PHOTO_CONCURRENCY`).
2. `CustomerPhotoStore.ensureStored()`
   ([`photos/customer-photo.store.ts`](../../../../apps/api/src/modules/conversations/photos/customer-photo.store.ts))
   reads the message, then, with no transaction open, downloads each photo
   not yet copied (up to ten a message), re-encodes it with
   `normalizeProductImage` (JPEG, at most 2048 px, no EXIF, so no location
   from the customer's phone) and puts it at
   `c/<merchant>/<message id>-<n>.jpg`.
3. A short transaction locks the message row and writes each result into
   `details.attachments[n]`: `key` for a copy, `failed` for a photo that
   will never copy (`timeout`, `too_large`, `not_allowed`, `unreadable`,
   `failed`). A failed photo is not tried again.

`downloadPhoto()`
([`photos/photo-download.ts`](../../../../apps/api/src/modules/conversations/photos/photo-download.ts))
fetches only `https` links on Meta's CDNs (`fbcdn.net`, `fbsbx.com` and their
subdomains), follows at most three redirects by hand and checks each hop, and
holds one 10 s deadline and a 10 MB cap (`PHOTO_DOWNLOAD_LIMITS`), checked
against `content-length` and again while the body streams. It never throws.

The key is fixed per photo of a message, so a retry, or the copy job and the
turn racing, rewrite one object with the same photo instead of leaving a
second behind. While storage is down nothing is recorded and the job throws
for BullMQ to retry.

### The turn

In `browsing` or `collecting_details`, `decideNonText()` now leaves a photo
to the turn. On the summary card a photo still gets the Confirm pointer
(phase 4). The turn takes the photo path when no tap, entry or shared post
came first and the burst (the customer's messages since the last reply) holds
a photo (`photosIn()` in
[`assistant/photo-turn.ts`](../../../../apps/api/src/modules/conversations/assistant/photo-turn.ts)),
so "do you have this?" typed after the photo reads the photo too.

`readPhotos()` in `assistant-turn.service.ts` does, with no transaction open
across any download or call:

1. **Copy.** `ensureStored()` for each photo message, newest first, at most
   three photos a turn (`MAX_PHOTOS_PER_TURN`). The copy job has usually done
   it already.
2. **Cap.** Six vision calls per conversation in 24 hours
   (`VISION_CALLS_PER_DAY`), counted from `llm_call`. The seventh hands off
   (`unreadable`) and the seller looks.
3. **Shortlist.** `photoShortlist()` takes the turn's own catalog
   (`findSellableCatalog(merchantId)`, so another shop's products never
   appear): sellable products with a cover, narrowed to a category the
   customer's words name, with any product they name first, at most 20
   (`MAX_PHOTO_CANDIDATES`).
4. **Ask the model.** `matchProductPhoto` ([AI](../../../architecture/ai.md#matchproductphoto))
   gets our copies of the photos and the numbered candidates' thumbnails and
   returns at most three numbers with confidence. `matchedProductIds()` maps
   them back, discards any number not shown and anything under 0.6, and
   counts a product once.
5. **Decide.** `decidePhoto()` in `conversation-machine.ts` shares
   `offerProducts()` with the shared post's `decideSharedPost()`: the
   candidates are offered for a new item and nothing fills a slot.

| Outcome                                  | Reply                                                                                           | Slots                                                           |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| One match                                | Its cover, then "Is it this one: …?" with **Yes** (`pick:product:<id>`) and **No** (`photo:no`) | `offered` holds it                                              |
| Two or three                             | "Is it one of these?", then a carousel of covers and lowest prices, each with **This one**      | `offered` holds them                                            |
| None, or none sure enough                | "Sorry, I couldn't tell which product is in the photo. Could you type its name?"                | `lastAsked` one short of `MAX_ASKS`, so the next miss hands off |
| Not downloaded, too large, not an image  | "Sorry, I couldn't open that photo. Could you type the product's name?", and no model call      | as above                                                        |
| **No** tapped                            | "Okay. Which product are you looking for? Please type its name." (`decideNotIt()`)              | as above                                                        |
| Vision call failed, or no LLM configured | hand-off `llm_failed`                                                                           |                                                                 |
| Already 10 items                         | hand-off `awaiting_seller`                                                                      |                                                                 |

**Yes** and a carousel tap are ordinary picks: `validPick()` checks the id was
offered, and the item is added as from a shared post. The replies are fixed
lines in `assistant-fallbacks.ts` (draft Bangla, to be reviewed), never
phrased, and prices come only from the catalog.

### Data

- Migration `0045_llm_call_vision_match` re-creates `llm_call_purpose_ck`
  with `vision_match`, the new member of `LLM_CALL_PURPOSES` and
  `LLM_PURPOSES`.
- `messageDetailsSchema` gains `attachments[].key` and
  `attachments[].failed`. No new column.
- `AssistantPayload` gains `{ kind: 'not_it' }`, encoded `photo:no`.

### Dashboard

`toMessage()` serves a copied photo from the bucket
(`ObjectStorage.publicUrl(key)`) and an uncopied one from Meta's link as
before, so the viewer needs no change: a photo stays visible after Meta's
link expires.

## Decisions

- **The model names numbers, not ids.** Candidates are shown as `Candidate 1`
  … `Candidate 20`, which costs fewer tokens than uuids and makes "an id not
  on the list" a number out of range, which code drops.
- **The model reads our copy, by link.** The photo and the thumbnails are
  `https` links to our public bucket, which OpenAI fetches; the worker never
  sends image bytes. Customer photos are therefore public by their
  unguessable key, as product photos are.
- **The extraction model, no new variable.** `LLM_MODEL_EXTRACTION` reads
  images, and a wrong match costs more than the call.
- **The copy job and the turn share one store.** The ingest's own job stays
  fast (Meta's CDN can be slow and the messenger queue runs one job at a
  time), and the turn never waits for the copy job.
- **A photo with words beside it reads the photo.** As with a shared post,
  the words only narrow the shortlist; a phone number sent in the same burst
  is asked for again later.
- **The cap is per conversation per day,** on top of three photos a turn. A
  burst is one turn, so ten photos in a row are one call.

## Meta / App Review

Nothing new; images arrive through `messages`.

## Rules it must keep

A photo match is a suggestion until the customer confirms it; price and stock
come from the catalog. Never call the model inside a transaction.

## Tests

- **`photo-turn.spec.ts`**: the burst's photos newest first, three at most,
  an unsent one skipped; the shortlist keeps sellable products with a cover,
  narrows to a named category and puts a named product first; numbers not
  shown are discarded, low confidence dropped, a product counted once.
- **`photo-download.spec.ts`**: Meta's hosts only (no `http`, credentials,
  ports, look-alike hosts or IPs); a redirect off them refused; oversize by
  header and while streaming; a timeout; a 404 and a network error.
- **`customer-photo-keys.spec.ts`**: fixed keys, never under `m/`.
- **`customer-photo.store.spec.ts`** (DB): each photo copied once and its key
  recorded; a refused download recorded and not retried; bytes that are not
  an image; storage down records nothing; only a customer's photo; another
  merchant's message is never read or written, and the new repository methods
  filter by merchant.
- **`assistant-turn.service.spec.ts`** (DB), "product photos": "Is it this
  one?" with the cover, Yes and No, our copy read by the model and recorded on
  the message; Yes fills the product; several as a carousel; a number not on
  the list discarded; low confidence asks for the name; No asks for the name
  and a second miss hands off; a timeout or oversize download gets the fixed
  line with no model call; another merchant's products never reach the
  model; a failed call hands off; the daily cap hands off.
- **`inbound-message.ingest.spec.ts`** (DB): every customer photo queues one
  copy, on a handed-off chat too; a sticker or words queue none.
- **`outgoing.spec.ts`**, **`llm.client.spec.ts`**,
  **`conversation-mappers.spec.ts`**, **`non-text-turn.spec.ts`**,
  **`slots.spec.ts`**: Yes / No and the carousel; images sent as links and a
  bound broken as invalid output; the viewer's link; a photo left to the
  turn; `photo:no` round-trips.

## Follow-ups

- Run it on the dev Page with real photos and screenshots of catalog
  products, and record the hit rate ([Done when](#done-when)).
- A photo evaluation set, like `catalog-match.eval.spec.ts`, if the hit rate
  needs tuning; then embeddings before the call, as the scope says.
- No sweep for `c/` yet. A copy is written only at the key its message
  records, so a photo is orphaned only if its message row goes away.
- A native-speaker review of the Bangla lines.
- Stickers, video, audio and files are still shown from Meta's expiring
  links.

## Done when

- [ ] On the dev Page, a photo of a catalog product gets "Is it this one?"
      with the right product in most tries on a small evaluation set (record
      the hit rate).
- [ ] Every photo shows in the conversation viewer.

Also run (Oct 17, 2026): shared build, typecheck, lint, format and tests
pass, the new database suites ran, and `db:verify-rls` passes after migration
`0045`. Nothing was sent from the dev Page, and the viewer was not opened in a
browser.
