# Connect flow

The requests a seller's browser, the API, and Facebook exchange to connect a
Page. See [03 · Connect Facebook Page](README.md) for the routes, the error
codes, and the rules behind each step.

```mermaid
sequenceDiagram
    autonumber
    actor Seller as 👤 Seller
    participant SPA as 🌐 SPA /settings/messenger
    participant API as ⚙️ FacebookPageController
    participant FB as 🔐 Facebook
    participant DB as 💾 facebook_page

    Seller->>SPA: Click Connect
    SPA->>API: POST /authorizations
    API-->>SPA: 201 { url }, sets page_connect cookie (authorizing, state)
    SPA->>FB: Browser opens the Login dialog, 3 Page scopes, auth_type=rerequest
    Seller->>FB: Grant the Page permissions
    FB->>API: Redirect to GET /oauth/callback with code and state
    API->>API: openFlow, then stateMatches
    API->>FB: GET /oauth/access_token, code to short-lived to long-lived user token
    API->>FB: GET /me/permissions
    alt every scope granted
        API-->>SPA: 302 ?step=choose-page, re-seals the cookie (authorized, userToken)
    else any check fails
        API-->>SPA: 302 ?error=code, clears the cookie
    end

    SPA->>API: GET /candidates
    API->>FB: GET /me/accounts (id, name, tasks)
    API-->>SPA: 200 { pages: [{ pageId, name, canMessage }] }

    Seller->>SPA: Pick a Page
    SPA->>API: PUT / with { pageId }
    API->>DB: findForMerchant, refuse a different Page with 409
    API->>FB: GET /me/accounts with access_token, check MESSAGING
    API->>FB: POST /pageId/subscribed_apps
    API->>DB: withMerchant, lock the row, insert or update with the encrypted token
    API-->>SPA: 200 FacebookPage, clears the cookie
```

Every route, the callback included, runs behind `SessionGuard` and
`TenantGuard`. The `page_connect` cookie carries the flow between requests,
so the API keeps no flow state of its own.

Graph calls run outside any transaction. The connect step makes two short
transactions: a read before Facebook is called, and the write after. The
write takes a row lock and re-checks the shop's Page, so two connects in
parallel cannot both succeed.
