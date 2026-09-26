---
name: rest-api-design
description: >
  Design RESTful APIs following best practices for resource modeling, HTTP
  methods, status codes, versioning, and documentation. Use when creating new
  APIs, designing endpoints, or improving existing API architecture.
---

# REST API Design

## Table of Contents

- [Overview](#overview)
- [When to Use](#when-to-use)
- [Quick Start](#quick-start)
- [Reference Guides](#reference-guides)
- [Best Practices](#best-practices)

## Overview

Design REST APIs that are intuitive, consistent, and follow industry best practices for resource-oriented architecture.

## When to Use

- Designing new RESTful APIs
- Creating endpoint structures
- Defining request/response formats
- Implementing API versioning
- Documenting API specifications
- Refactoring existing APIs

## Quick Start

Minimal working example:

```
✅ Good Resource Names (Nouns, Plural)
GET    /api/users
GET    /api/users/123
GET    /api/users/123/orders
POST   /api/products
DELETE /api/products/456

❌ Bad Resource Names (Verbs, Inconsistent)
GET    /api/getUsers
POST   /api/createProduct
GET    /api/user/123  (inconsistent singular/plural)
```

## Reference Guides

Detailed implementations in the `references/` directory:

| Guide                                                        | Contents                                                                            |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| [Resource Naming](references/resource-naming.md)             | Resource Naming, HTTP Methods & Operations                                          |
| [Request Examples](references/request-examples.md)           | Request Examples                                                                    |
| [Query Parameters](references/query-parameters.md)           | Query Parameters                                                                    |
| [Response Formats](references/response-formats.md)           | Response Formats                                                                    |
| [HTTP Status Codes](references/http-status-codes.md)         | HTTP Status Codes, API Versioning, Authentication & Security, Rate Limiting Headers |
| [OpenAPI Documentation](references/openapi-documentation.md) | Generic OpenAPI example — in this repo, see "OpenAPI in this repo" below            |

## Best Practices

### ✅ DO

- Use nouns for resources, not verbs
- Use plural names for collections
- Be consistent with naming conventions
- Return appropriate HTTP status codes
- Include pagination for collections
- Provide filtering and sorting options
- Version your API — see "Versioning in this repo" below
- Document thoroughly with OpenAPI
- Use HTTPS
- Implement rate limiting
- Provide clear error messages
- Use ISO 8601 for dates

### ❌ DON'T

- Use verbs in endpoint names
- Return 200 for errors
- Expose internal IDs unnecessarily
- Over-nest resources (max 2 levels)
- Use inconsistent naming
- Forget authentication
- Return sensitive data
- Break backward compatibility without versioning

### Versioning in this repo

Routes live at `/api/v1/...` through Nest URI versioning (`configureApp` in
`apps/api/src/bootstrap.ts`, `defaultVersion: '1'`).

- **Additive changes stay in v1:** a new route, a new optional request field, a
  new response field.
- **A breaking change versions one route, not the API.** Add a
  `@Version('2')` handler for the affected route beside the existing one,
  which keeps serving v1. Never copy the whole API into a v2.
- **Pinned paths:** Better Auth's `basePath` (`/api/v1/auth`) and the Meta
  webhook (`/api/v1/webhooks/messenger`) follow contracts we don't own. They
  are not bumped with our versions. `/health` is `VERSION_NEUTRAL`.
- **Deferred:** deprecation windows and `Deprecation`/`Sunset` headers wait
  until an outside consumer exists.

### OpenAPI in this repo

The spec is generated at boot from the controllers, never written by hand, and
served in development only: Swagger UI at `/api/docs`, JSON at
`/api/docs/openapi.json` (`apps/api/src/openapi/openapi.ts`). Better Auth's
routes are merged in from its `openAPI()` plugin by `mergeAuthDocument`.

- **Every route is annotated:** `@ApiTags` on the controller, and
  `@ApiOperation({ summary })` plus a success response on each handler.
- **Zod schemas document themselves.** Pass the shared schema to the parameter
  decorator and to the response. `@nestjs/swagger` converts it through Standard
  Schema, so there is no hand-written JSON Schema and no DTO class:

  ```ts
  @Post()
  @ApiCreatedResponse({ standardSchema: productSchema })
  @ApiCodedError(400, ['VALIDATION_FAILED'])
  create(
    @Body({ schema: createProductSchema, pipes: [new ZodValidationPipe(createProductSchema)] })
    body: CreateProduct,
  ) {}
  ```

- **Errors use `@ApiCodedError(status, codes)`** (`src/openapi/api-coded-error.ts`),
  which references the `ErrorResponse` component derived from the shared
  envelope schema. Its codes are typed against `ErrorCode`, so list the codes
  the handler actually throws.
- **Security defaults to the session cookie**, mirroring the global
  `SessionGuard`. A route marked `@AllowAnonymous()` also declares
  `security: []` in its `@ApiOperation`, or the docs claim it needs a login.
