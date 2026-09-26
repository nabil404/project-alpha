import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, type SchemaObject } from '@nestjs/swagger';
import { errorResponseBodySchema } from '@app/shared';
import { z } from 'zod';
import type { Auth } from '../auth/auth.module.js';
import { ERROR_RESPONSE_SCHEMA } from './api-coded-error.js';
import { mergeAuthDocument, SESSION_COOKIE_SCHEME } from './merge-auth-document.js';

export const OPENAPI_UI_PATH = 'api/docs';
export const OPENAPI_JSON_PATH = 'api/docs/openapi.json';

/** Better Auth's default cookie name; its `__Secure-` variant only exists over HTTPS. */
const SESSION_COOKIE = 'better-auth.session_token';

/**
 * Builds one OpenAPI document for every route the server answers - our Nest
 * controllers plus Better Auth - and serves it as Swagger UI at /api/docs and
 * JSON at /api/docs/openapi.json. main.ts calls this outside production only.
 *
 * Both are mounted straight on the HTTP adapter, not through Nest routing, so
 * SessionGuard never sees them. The worker has no HTTP server and never calls
 * this.
 *
 * Every operation needs the session cookie unless it says otherwise, because
 * SessionGuard is global; @AllowAnonymous() routes declare `security: []`.
 *
 * The page only works from the SPA's origin (APP_URL - the Vite proxy in dev,
 * Caddy when deployed). Better Auth's origin check trusts nothing else, so
 * opened on the API's own port its "Try it out" calls get INVALID_ORIGIN.
 */
export async function setupOpenApi(app: INestApplication, auth: Auth): Promise<void> {
  const config = new DocumentBuilder()
    .setTitle('Messenger-to-Order API')
    .setDescription(
      'Seller dashboard API, Messenger webhook and Better Auth. Every error is the coded ' +
        'envelope `{ error: { code, message, params } }`.\n\n' +
        '**Open this page from the SPA origin** (`/api/docs` on `APP_URL`, which is ' +
        'http://localhost:5173 in development). Better Auth trusts no other origin, so ' +
        'from the API port every auth call fails with `INVALID_ORIGIN`.',
    )
    .setVersion('1')
    .addCookieAuth(SESSION_COOKIE, { type: 'apiKey', in: 'cookie' }, SESSION_COOKIE_SCHEME)
    .addSecurityRequirements(SESSION_COOKIE_SCHEME)
    .build();

  const document = SwaggerModule.createDocument(app, config);
  document.components = {
    ...document.components,
    schemas: { ...document.components?.schemas, [ERROR_RESPONSE_SCHEMA]: errorResponseSchema() },
  };

  const merged = mergeAuthDocument(
    document,
    await auth.api.generateOpenAPISchema(),
    auth.options.basePath,
  );

  SwaggerModule.setup(OPENAPI_UI_PATH, app, merged, {
    useGlobalPrefix: false,
    jsonDocumentUrl: OPENAPI_JSON_PATH,
    raw: ['json'],
  });
}

/**
 * The envelope from @app/shared, so the documented error shape is the one the
 * SPA parses. OpenAPI 3.0 is the dialect @nestjs/swagger converts every other
 * Zod schema into as well.
 */
function errorResponseSchema(): SchemaObject {
  const schema = z.toJSONSchema(errorResponseBodySchema, { target: 'openapi-3.0', io: 'output' });
  delete schema.$schema;
  return schema as SchemaObject;
}
