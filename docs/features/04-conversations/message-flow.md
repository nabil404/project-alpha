# Message flow

How a Messenger message reaches the seller's dashboard, and how a seller's
reply goes out. See [04 · Conversations](README.md) for the routes, the error
codes, and the rules behind each step.

## A customer message

```mermaid
sequenceDiagram
    autonumber
    participant Meta as 🌐 Meta
    participant Hook as 🔐 MessengerController
    participant Queue as 📬 messenger-inbound
    participant Ingest as ⚙️ InboundMessageIngest
    participant DB as 💾 Postgres
    participant Redis as ⚡ conversation-events
    participant API as ⚙️ ConversationsController
    participant SPA as 🌐 SPA /conversations

    Meta->>Hook: POST /api/v1/webhooks/messenger
    Hook->>Hook: verifyMetaSignature, then parseInboundJobs
    Hook->>Queue: add inbound-message, jobId = mid
    Hook-->>Meta: 200 EVENT_RECEIVED
    Queue->>Ingest: customer-message, customer-postback or page-echo
    Note over Ingest: An echo carrying our META_APP_ID stops here as own-echo
    Ingest->>DB: app_page_merchant(pageId), and null stops as unknown-page
    Ingest->>DB: withMerchant reads the customer and the shop's Page
    opt needsProfile
        Ingest->>Meta: GET /psid?fields=name,profile_pic, outside any transaction
    end
    Ingest->>DB: withMerchant upserts the customer, locks or creates the conversation, inserts the message
    alt the message id is already stored
        Ingest-->>Queue: duplicate, nothing published
    else stored
        Ingest->>DB: same transaction moves last_* forward, and a seller echo sets bot_paused
        Ingest->>Redis: after commit, PUBLISH merchantId, conversationId, kind
        opt a customer message the assistant should answer
            Ingest->>Ingest: add an assistant-turn job
        end
    end
    Redis->>API: ConversationEventsHub fans out to the shop's streams
    API-->>SPA: SSE conversation.updated with conversationId
    SPA->>API: refetch the list, counts and open thread over REST
```

The worker runs steps 5 to 13. The webhook does no database work, so Meta
gets its `200` before the message is stored. `PUT /:id/read`, `PATCH /:id`,
`POST /:id/messages`, `DELETE /:id/messages/:messageId` and the assistant's
sends publish to the same channel after their own commits.

## A seller reply

```mermaid
sequenceDiagram
    autonumber
    actor Seller as 👤 Seller
    participant SPA as 🌐 SPA /conversations/:id
    participant API as ⚙️ ConversationsService
    participant DB as 💾 Postgres
    participant Graph as 🌐 Meta Graph
    participant Redis as ⚡ conversation-events

    Seller->>SPA: Type a reply, press Enter
    SPA->>API: POST /api/v1/conversations/:id/messages
    API->>DB: withMerchant locks the conversation, checks the window and the Page
    Note over API,DB: A failed check answers 404 or 409 and stores nothing
    API->>DB: same transaction stores the reply as sending, moves last_*, sets bot_paused
    API->>Graph: after commit, POST /me/messages with messaging_type RESPONSE, 10 s timeout
    alt Graph returns a message id
        API->>DB: markSent with the Meta message id
        API->>Redis: PUBLISH kind message
        API-->>SPA: 201 Message with status sent
    else refused, timed out, or no message id
        API->>DB: markFailed
        API->>Redis: PUBLISH kind message
        API-->>SPA: 502 MESSENGER_SEND_FAILED
    end
```

No transaction is open during the Graph call. A failed reply stays in the
thread, and the assistant stays paused. Meta echoes a delivered reply back to
the webhook with our app id, and the ingest skips it as `own-echo`.
