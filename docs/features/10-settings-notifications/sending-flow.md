# Sending flow

How an event becomes seller emails. See
[10 · Settings – Notifications](README.md) for each email's conditions and the
switches that gate them.

## An event email

New order drafted and customer waiting take the same path. The caller
reports the event only after its transaction commits.

```mermaid
sequenceDiagram
    autonumber
    participant Caller as ⚙️ OrderConfirmation / AssistantTurn
    participant Svc as ⚙️ NotificationsService
    participant Queue as 📬 notifications
    participant Proc as ⚙️ NotificationsProcessor
    participant Comp as ⚙️ NotificationComposer
    participant DB as 💾 Postgres
    participant Mail as ⚙️ MailService

    Caller->>Svc: orderDrafted(merchantId, orderId) or handedOff(merchantId, conversationId, at)
    Svc->>Queue: add order-drafted or customer-waiting, jobId from the event
    Note over Queue: customer-waiting waits 10 minutes. A repeat jobId is a no-op.
    Queue->>Proc: the event job
    Proc->>Comp: still wanted?
    Comp->>DB: withMerchant reads the order or chat, then the recipients
    alt no longer wanted, or nobody has the switch on
        Comp-->>Proc: no emails
    else
        Comp-->>Proc: one email per recipient
        Proc->>Queue: addBulk send-email, jobId = eventJobId-userId
        Queue->>Proc: each send-email job
        Proc->>Mail: send(message), outside any transaction
        Note over Proc,Mail: A failure throws, and BullMQ retries that one send
    end
```

## The daily summary

```mermaid
sequenceDiagram
    autonumber
    participant Sched as ⏱ daily-summary-scan
    participant Queue as 📬 notifications
    participant Proc as ⚙️ NotificationsProcessor
    participant Comp as ⚙️ NotificationComposer
    participant DB as 💾 Postgres

    Sched->>Queue: daily-summary-scan, every 15 minutes in UTC
    Queue->>Proc: the scan job
    Proc->>Comp: dailySummariesDue(opts.prevMillis)
    loop each shop
        Comp->>DB: the shop's time zone
        opt the scheduled time is 9:00–9:14 there
            Comp->>DB: recipients with the switch on
        end
    end
    Comp-->>Proc: shops due, each with yesterday's date
    Proc->>Queue: addBulk daily-summary, jobId = daily-summary-merchantId-day
    Queue->>Proc: each daily-summary job
    Proc->>Comp: dailySummary(merchantId, day)
    Comp->>DB: yesterday's order count and total, cancelled and returned left out
    Note over Comp: No orders that day means no email
    Comp-->>Proc: one email per recipient
    Proc->>Queue: send-email jobs, as for an event
```
