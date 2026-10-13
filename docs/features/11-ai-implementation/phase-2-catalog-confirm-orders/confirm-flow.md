# Confirm flow

How a message becomes a summary card, and how a Confirm tap becomes one
order. See [11.2](README.md#confirm) for the rules behind each step, and
[phase 1's turn flow](../phase-1-foundation/turn-flow.md) for the turn
around the matching.

## From a message to the card

What phase 2 adds inside phase 1's turn, between the read and the write.

```mermaid
flowchart TD
    msg["🌐 Customer message or quick-reply tap"]:::entry --> pick{"A tap on a<br/>candidate the last<br/>reply offered?"}:::decision
    pick -- yes --> fill["⚙️ Fill that item<br/>no LLM call"]:::work
    pick -- no --> llm["🤖 classifyIntent, then extractOrder<br/>the whole item list with refs"]:::work
    llm --> merge["⚙️ mergeItems, mergeSameVariant<br/>item-merge.ts"]:::work
    merge --> match["⚙️ matchProduct, matchVariant per item<br/>catalog-match.ts"]:::work
    fill --> match
    match --> clear{"Every item has a clear<br/>product, variant and<br/>quantity in stock?"}:::decision
    clear -- "close candidates" --> offer["⚙️ Ask with up to 3 quick replies<br/>pick:product:id or pick:variant:id"]:::work
    clear -- "not found, sold out, too many" --> ask["⚙️ Ask again with the reason<br/>counts toward 3 asks"]:::work
    clear -- yes --> details{"Name, phone and<br/>address collected?"}:::decision
    details -- no --> askd["⚙️ Ask the next detail"]:::work
    details -- yes --> area{"matchArea finds an area<br/>or everywhere else?"}:::decision
    area -. no .-> hand[/"❌ Hand off<br/>no_delivery_charge"/]:::reject
    area -- yes --> card["✅ quoteFor every line<br/>awaiting_confirmation, revision + 1<br/>summary card with Confirm and Change"]:::work
    ask -. third ask .-> hand2[/"❌ Hand off<br/>repeated_confusion"/]:::reject

    classDef entry    fill:#E6E6FA,stroke:#333,stroke-width:2px,color:#00008B
    classDef decision fill:#FFD700,stroke:#333,stroke-width:2px,color:#000
    classDef work     fill:#90EE90,stroke:#333,stroke-width:2px,color:#006400
    classDef reject   fill:#FFB6C1,stroke:#DC143C,stroke-width:2px,color:#000
```

## A Confirm tap

`OrderConfirmationService.run`, in one transaction under the conversation
lock. Nothing in it calls the LLM.

```mermaid
flowchart TD
    tap["🌐 Confirm tap<br/>confirm:conversationId:revision"]:::entry --> lock["🔐 Lock the conversation"]:::guard
    lock --> mine{"Not paused, the shop's Page,<br/>this conversation and merchant?"}:::decision
    mine -. no .-> none[/"Nothing sent"/]:::reject
    mine -- yes --> exists{"Order keyed<br/>assistant:id:revision exists?"}:::decision
    exists -- yes --> replied{"This tap already<br/>has a reply?"}:::decision
    replied -- no --> resend["✅ Send its reference"]:::work
    replied -- "sent" --> done[/"Nothing more sent"/]:::work
    replied -- "failed, or sending past the 20 s lease" --> claim["⚙️ claimForResend<br/>resend the stored row"]:::work
    replied -. "sending, inside the lease" .-> retry[/"❌ ReplyInFlightError<br/>the job retries"/]:::reject
    exists -- no --> current{"awaiting_confirmation,<br/>this revision and its quote?"}:::decision
    current -. no .-> stale[/"❌ Stale-card sentence"/]:::reject
    current -- yes --> lines{"Every line live, in stock,<br/>product active?"}:::decision
    lines -. no .-> drop[/"❌ No order. Drop that item<br/>collecting_details, revision + 1"/]:::reject
    lines -- yes --> price{"Prices, fee and<br/>currency unchanged?"}:::decision
    price -. no .-> fresh[/"❌ No order. Price-changed line<br/>and a fresh card, revision + 1"/]:::reject
    price -- yes --> create["💾 createInTransaction<br/>source assistant, cash on delivery<br/>state confirmed"]:::store
    create --> after["✅ After commit: send the reference,<br/>then orderDrafted emails the seller"]:::work

    classDef entry    fill:#E6E6FA,stroke:#333,stroke-width:2px,color:#00008B
    classDef guard    fill:#87CEEB,stroke:#333,stroke-width:2px,color:#00008B
    classDef decision fill:#FFD700,stroke:#333,stroke-width:2px,color:#000
    classDef work     fill:#90EE90,stroke:#333,stroke-width:2px,color:#006400
    classDef store    fill:#E6E6FA,stroke:#333,stroke-width:2px,color:#00008B
    classDef reject   fill:#FFB6C1,stroke:#DC143C,stroke-width:2px,color:#000
```

A **Change** tap on the current card moves the chat to `collecting_details`
with `revision + 1` and asks what to change; on any other card it gets the
stale sentence.
