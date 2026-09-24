# Response Formats

## Success Response

```json
{
  "data": {
    "id": "123",
    "email": "user@example.com",
    "firstName": "John"
  },
  "meta": {
    "timestamp": "2025-01-15T10:30:00Z",
    "version": "1.0"
  }
}
```

## Collection Response with Pagination

```json
{
  "data": [
    { "id": "1", "name": "Product 1" },
    { "id": "2", "name": "Product 2" }
  ],
  "pagination": {
    "page": 2,
    "limit": 20,
    "total": 145,
    "totalPages": 8,
    "hasNext": true,
    "hasPrev": true
  },
  "links": {
    "self": "/api/products?page=2&limit=20",
    "first": "/api/products?page=1&limit=20",
    "prev": "/api/products?page=1&limit=20",
    "next": "/api/products?page=3&limit=20",
    "last": "/api/products?page=8&limit=20"
  }
}
```

## Error Response

> **This section is this project's binding contract**, unlike the generic
> guidance above. It describes what `apps/api` actually emits and what
> `apps/web` parses. Implementation lives in `apps/api/src/common/errors/`;
> the shared types live in `packages/shared/src/errors/`.

Every error response, whatever threw it, is one envelope:

```json
{
  "error": {
    "code": "AUTH_INVALID_CREDENTIALS",
    "message": "Invalid email or password",
    "params": {}
  }
}
```

- **`code`** is the machine-readable part of the contract — a member of the
  `ErrorCode` union in `@app/shared`. Renaming one is a breaking change.
  Framework errors this design never reached (Nest's own 404 for an unmatched
  route) get a synthesized `HTTP_<status>`, so the shape holds everywhere.
- **`message`** is an English fallback for logs and non-web consumers. **The SPA
  never renders it.** It resolves `code` through the `errors` i18n namespace
  (`apps/web/src/i18n/error-keys.ts`) and interpolates `params`.
- **`params`** carries the interpolation values, which is what keeps the copy
  translatable: `{ "min": 12 }`, never a pre-built "must be at least 12
  characters" the frontend would have to parse back apart.
- There is **no `meta` block** and no `details` array — this API emits neither.

Validation failures add a `fields` map, keyed by the dotted path of the property
that failed, so the SPA can attach each message to its own form control:

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Validation failed",
    "params": {},
    "fields": {
      "items.0.quantity": [
        {
          "code": "MIN_VALUE",
          "message": "Too small: expected number to be >0",
          "params": { "min": 0 }
        }
      ]
    }
  }
}
```

A field can carry more than one failure, so the value is always an array. An
issue about the body as a whole rather than one property is keyed `_root`.

### Throwing one

Use the `Coded*Exception` classes rather than the bare NestJS exception, so the
response carries a code:

```ts
throw new CodedUnauthorizedException('AUTH_INVALID_CREDENTIALS', 'Invalid email or password');
```

`ZodValidationPipe` builds the `fields` map from Zod issues on its own — a Zod
issue already carries its raw constraint argument (`too_small` has `minimum`,
`invalid_format` has `format`) — so a new validated endpoint needs no per-field
error wiring.

### Better Auth (`/api/auth/*`)

Better Auth writes its responses straight to the socket and **bypasses
`AllExceptionsFilter` entirely**. A global `hooks.after` in
`apps/api/src/auth/auth.config.ts` rewrites every error it returns (status
≥ 400; its 302 redirects pass through) into this same envelope, using the pure
mapping in `apps/api/src/auth/auth-errors.ts`:

| Better Auth                         | Envelope                                                    |
| ----------------------------------- | ----------------------------------------------------------- |
| `INVALID_EMAIL_OR_PASSWORD`         | `AUTH_INVALID_CREDENTIALS`                                  |
| `EMAIL_NOT_VERIFIED`                | `AUTH_EMAIL_NOT_VERIFIED`                                   |
| `INVALID_TOKEN`, `TOKEN_EXPIRED`    | `AUTH_INVALID_TOKEN`                                        |
| `PASSWORD_TOO_SHORT` / `_TOO_LONG`  | `VALIDATION_FAILED`, `fields.password` (or `newPassword`)   |
| `INVALID_EMAIL`                     | `VALIDATION_FAILED`, `fields.email` = `INVALID_FORMAT`      |
| `VALIDATION_ERROR` (request schema) | `VALIDATION_FAILED`, one `INVALID_INPUT` per reported field |
| any other 401                       | `AUTH_UNAUTHENTICATED`                                      |
| anything else                       | `HTTP_<status>`                                             |

A rejection by Better Auth's own rate limiter is answered before any hook runs,
so it still arrives in Better Auth's shape; the SPA's parser degrades it to
`HTTP_429`.

The global `SessionGuard` answers a route without a session as
`AUTH_UNAUTHENTICATED`, rather than the bare 401 the library's guard throws.
