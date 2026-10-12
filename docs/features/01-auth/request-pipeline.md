# Request pipeline

The path an API request takes from Caddy to the database. See
[01 · Authentication](README.md#request-pipeline) for what each guard does.

```mermaid
flowchart TD
    req([🌐 Request from Caddy]) --> route{Path?}

    route -- "/api/v1/auth/*" --> ba["🔐 Better Auth handler<br/>own rate limiter<br/>no Nest guards"]
    route -- "any other /api route, /health" --> throttle

    subgraph global ["Global guards"]
        throttle["🚦 ThrottlerGuard<br/>120 req / 60 s per IP<br/>Redis-backed"]
        anon{"@AllowAnonymous()?"}
        session["🔐 SessionGuard<br/>loads Better Auth { session, user }"]
        throttle --> anon
        anon -- no --> session
    end

    subgraph controller ["Per controller"]
        tenant["🏪 TenantGuard<br/>reads session.activeOrganizationId"]
    end

    subgraph data ["Data layer"]
        handler["⚙️ Controller → service"]
        tx["withMerchant(db, merchantId, tx => …)<br/>opens the transaction<br/>set_config('app.current_merchant')"]
        repo["repository(tx, { merchantId }, …)<br/>filters on merchant_id"]
        pg[("💾 Postgres<br/>RLS: merchant_id = app_current_merchant()")]
        handler --> tx --> repo --> pg
    end

    anon -- "yes: /health, Meta webhooks" --> public["⚙️ Public handler"]
    session --> tenant
    tenant -- "sets request.merchantId" --> handler

    throttle -. over the limit .-> r429[/"❌ 429 HTTP_429"/]
    session -. no session .-> r401[/"❌ 401 AUTH_UNAUTHENTICATED"/]
    tenant -. no activeOrganizationId .-> r403[/"❌ 403 TENANT_NO_ACTIVE_MERCHANT"/]

    classDef entry fill:#E6E6FA,stroke:#333,stroke-width:2px,color:#00008B
    classDef guard fill:#87CEEB,stroke:#333,stroke-width:2px,color:#00008B
    classDef decision fill:#FFD700,stroke:#333,stroke-width:2px,color:#000
    classDef work fill:#90EE90,stroke:#333,stroke-width:2px,color:#006400
    classDef store fill:#E6E6FA,stroke:#333,stroke-width:2px,color:#00008B
    classDef reject fill:#FFB6C1,stroke:#DC143C,stroke-width:2px,color:#000

    class req entry
    class throttle,session,tenant,ba guard
    class route,anon decision
    class handler,public,repo,tx work
    class pg store
    class r429,r401,r403 reject
```

Solid arrows are the path a request takes when it passes. Dotted arrows are
rejections, each sent in the API's `{ error: { code, message, params } }`
envelope.

Better Auth mounts `/api/v1/auth/*` outside Nest routing, so none of the Nest
guards run for it. The throttle limit is the default. A few routes set a
tighter `@Throttle()`, and the Messenger webhook and the conversations
event stream opt out with `@SkipThrottle()`.
