# Turn flow

One assistant turn, from a stored customer message to the reply. See
[11.1 · Foundation](README.md) for the rules behind each step, and
[Conversations' message flow](../../04-conversations/message-flow.md) for how
the message is stored.

```mermaid
sequenceDiagram
    autonumber
    participant Ingest as ⚙️ InboundMessageIngest
    participant Queue as 📬 assistant-turns
    participant Turn as ⚙️ AssistantTurnService
    participant DB as 💾 Postgres
    participant LLM as 🤖 LlmClient
    participant Sender as ⚙️ OutboundMessageSender
    participant Meta as 🌐 Graph API

    Ingest->>Queue: after commit, add assistant-turn, jobId turn-mid, delay 2.5 s
    Note over Ingest,Queue: Only if not paused or handed_off, bot_enabled, LLM_API_KEY and META_APP_ID set
    Queue->>Turn: run(merchantId, conversationId, triggerMessageId)
    Turn->>DB: withMerchant reads the conversation, last 20 messages, Page token, country
    alt paused, handed_off, confirmed, stale trigger, or already answered
        Turn-->>Queue: stop, no LLM call
    else
        Turn->>LLM: classifyIntent, routing model, no transaction open
        opt shouldExtract(state, intent)
            Turn->>LLM: extractOrder, extraction model
        end
        Turn->>Turn: decideTurn, pure: ask_slot, summary or handoff
        opt ask_slot or summary
            Turn->>LLM: phraseReply, then checkReply against the facts
            Note over Turn: A failed phrasing or check uses the fixed fallback sentence
        end
        Turn->>DB: lock the conversation, write llm_call rows, re-check the gate and the 24-hour window
        alt the re-check fails
            Turn-->>Queue: stop, only the llm_call rows kept
        else
            Turn->>DB: write state and slots, stage the reply as sending, commit
            Turn->>Sender: deliver the reply
            Sender->>Meta: POST /me/messages
            alt sent
                Sender->>DB: markSent, publish the conversation event
            else refused or timed out
                Sender->>DB: markFailed, then hand off
            end
            opt the turn handed off
                Turn->>Turn: NotificationsService.handedOff, the seller is emailed after 10 minutes
            end
        end
    end
```

An LLM error or timeout, output that fails Zod, confidence under 0.6, a
`complain` or `request_human` intent, or a third ask for one slot all end in
`decideTurn` returning `handoff` (no LLM configured counts as a failed call),
which sends the fixed hand-off sentence with no phrasing call.
