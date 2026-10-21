# Import flow

How a Facebook post import runs, from **Start import** to the drafts. See
[13 · Import products from Facebook posts](README.md) for the rules behind
each step.

## Starting a run

`ImportsService.create`, behind `POST /api/v1/imports`. The checks run in
this order, and the run is queued only once all of them pass.

```mermaid
sequenceDiagram
    autonumber
    actor Seller
    participant Web as 🌐 ImportDialog
    participant Api as ⚙️ ImportsService.create
    participant Db as 💾 Postgres
    participant Graph as Meta Graph
    participant Queue as 📬 catalog-imports

    Seller->>Web: Start import (since, until)
    Web->>Api: POST /imports
    alt no Graph client or no LLM_API_KEY
        Api-->>Web: 503 IMPORT_NOT_AVAILABLE
    end
    Api->>Db: Page, shop time zone, latest run
    alt until after the shop's today
        Api-->>Web: 400 VALIDATION_FAILED (until MAX_VALUE)
    else no connected Page
        Api-->>Web: 409 MESSENGER_PAGE_NOT_CONNECTED
    else a queued, running or stopping run
        Api-->>Web: 409 IMPORT_ALREADY_RUNNING
    end
    Api->>Graph: GET /{page-id}/published_posts?limit=1
    alt token refused
        Api-->>Web: 409 FACEBOOK_PERMISSION_MISSING
    else Graph down
        Api-->>Web: 503 FACEBOOK_UNAVAILABLE
    end
    Api->>Db: insert product_import (queued)
    Note over Api,Db: PRODUCT_IMPORT_ACTIVE_UIDX decides a race:<br/>the loser gets 409 IMPORT_ALREADY_RUNNING
    Api->>Queue: add import-run, id import-<runId>
    Api-->>Web: 202 ImportRun
    Web->>Seller: open /catalog/imports/:id
```

## The run

`ImportsProcessor` hands the `import-run` job to `ImportRunner.run`. Each
Graph page is read in turn, and the cursor is saved after each one, so a
retried or resumed job carries on from the page it was on.

```mermaid
flowchart TD
    job([📬 import-run job]) --> claim{"claim()<br/>run status?"}
    claim -- "stopping" --> stopped
    claim -- "gone, or not queued / running" --> skip([job ends, nothing changes])
    claim -- "queued or running → running" --> ctx{"Page token<br/>and LLM?"}

    ctx -- yes --> status{"run is stopping?"}
    status -- no --> page["⚙️ listPublishedPosts<br/>since, until, after = cursor"]
    status -- yes --> stopped

    page -- "last page (no paging.next)" --> total["set postsTotal"]
    page --> posts
    total --> posts

    subgraph each ["For each post on the page"]
        posts{"run is stopping?"}
        handle["⚙️ handle(post)<br/>see the next diagram"]
        llm{"5 LLM failures<br/>in a row?"}
        posts -- no --> handle --> llm
        llm -- "no, next post" --> posts
    end

    posts -- yes --> stopped
    llm -- yes --> failNA
    posts -- "page done" --> more{"more pages?"}
    more -- yes --> cursor["💾 save cursor"] --> status
    more -- no --> finished

    stopped["⏸ stopped"] --> end_
    finished["✅ finished"] --> end_
    failNA[/"❌ failed IMPORT_NOT_AVAILABLE"/] --> end_
    ctx -. no Page token .-> failPerm[/"❌ failed FACEBOOK_PERMISSION_MISSING"/]
    page -. "Graph code 10, 190, 200–299" .-> failPerm
    page -. "Graph down: throws, BullMQ retries from the cursor" .-> retry{"last attempt?"}
    retry -- yes --> failGraph[/"❌ failed FACEBOOK_UNAVAILABLE"/]
    failPerm --> end_
    failGraph --> end_
    end_["💾 end(): finishedAt, status<br/>NotificationsService.importFinished"]

    classDef entry fill:#E6E6FA,stroke:#333,stroke-width:2px,color:#00008B
    classDef decision fill:#FFD700,stroke:#333,stroke-width:2px,color:#000
    classDef work fill:#90EE90,stroke:#333,stroke-width:2px,color:#006400
    classDef store fill:#E6E6FA,stroke:#333,stroke-width:2px,color:#00008B
    classDef reject fill:#FFB6C1,stroke:#DC143C,stroke-width:2px,color:#000

    class job,skip entry
    class claim,ctx,status,posts,llm,more,retry decision
    class page,total,handle,stopped,finished work
    class cursor,end_ store
    class failNA,failPerm,failGraph reject
```

A run that fails keeps the drafts it already made. A run stopped before its
job starts ends as `stopped` in `claim()`, without reading Graph.

## One post

`ImportRunner.handle`. Every branch ends in `write()`, one short
`withMerchant` transaction that records the post's `product_import_post` row
and moves the run's counts. No transaction is open during the photo
download, the R2 upload or the LLM call.

```mermaid
flowchart TD
    post([Graph post]) --> own{"handled earlier<br/>in this run?"}
    own -- "yes, not failed" --> done([skip: already counted])
    own -- "no, or failed: read again" --> before{"product_post or an earlier<br/>run's row has it?"}

    before -- yes --> rImported["already_imported"]
    before -- no --> empty{"no caption<br/>and no photo?"}
    empty -- yes --> rEmpty["no_caption_or_photo"]
    empty -- no --> photos["⚙️ ImportPhotos.read + store<br/>up to 8, normalize-product-image, to R2"]

    photos -. unreadable .-> rPhoto[/"❌ photo_unreadable"/]
    photos --> llm["🤖 extractProductsFromPost<br/>caption + 4 photos"]
    llm -. "call failed: LLM failure count +1" .-> rLlm[/"❌ llm_failed"/]
    llm --> check["⚙️ checkPostProducts<br/>drop bad names, prices, categories"]

    check -- "not_product" --> rNot["not_a_product or<br/>no_named_product"]
    check -- products --> catalog{"every product matches<br/>the catalog? (matchProduct)"}
    catalog -- yes --> rCatalog["in_catalog<br/>stores extracted"]
    catalog -- no --> repeat{"matches a draft<br/>this run made?"}
    repeat -- yes --> merge["merge new photos<br/>into that draft"]
    repeat -- no --> create["ProductWriter: new draft<br/>its own photo copies"]

    merge --> write
    create --> write
    write["💾 write(): one transaction<br/>drafts, product_import_post row,<br/>llm_call rows, run counts"]
    write -- "exactly one product" --> link["💾 ProductPostRepository.linkIfFree"]
    write --> rDraft["✅ draft, or merged if none was new"]
    write -. lost a race .-> rWrite[/"❌ write_failed"/]

    rImported --> rec
    rEmpty --> rec
    rNot --> rec
    rCatalog --> rec
    rPhoto --> rec
    rLlm --> rec
    rec["💾 write(): product_import_post row<br/>and run counts, no product"]

    classDef entry fill:#E6E6FA,stroke:#333,stroke-width:2px,color:#00008B
    classDef decision fill:#FFD700,stroke:#333,stroke-width:2px,color:#000
    classDef work fill:#90EE90,stroke:#333,stroke-width:2px,color:#006400
    classDef store fill:#E6E6FA,stroke:#333,stroke-width:2px,color:#00008B
    classDef reject fill:#FFB6C1,stroke:#DC143C,stroke-width:2px,color:#000

    class post,done entry
    class own,before,empty,catalog,repeat decision
    class photos,llm,check,merge,create,rImported,rEmpty,rNot,rCatalog,rDraft work
    class write,link,rec store
    class rPhoto,rLlm,rWrite reject
```

Any LLM call that returns resets the run's failure count to 0. A product
that matches the catalog is left out of a post that still has new ones, and
the post's `matched_product_ids` keeps it. **Import anyway** runs the same
matching in `ImportRunner.importAnyway`; see
[Import anyway](README.md#import-anyway).
