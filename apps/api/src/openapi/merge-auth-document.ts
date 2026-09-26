import type { OpenAPIObject, OperationObject, PathItemObject } from '@nestjs/swagger';
import { ERROR_RESPONSE_REF } from './api-coded-error.js';

export const SESSION_COOKIE_SCHEME = 'sessionCookie';

/** The parts of Better Auth's generated document this merge reads. */
export interface AuthOpenApiDocument {
  paths: Record<string, object>;
  components?: { schemas?: Record<string, object> };
}

const TAG_RENAMES: Record<string, string> = { Default: 'Auth' };
const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']);

/**
 * Folds Better Auth's generated document (the openAPI() plugin) into ours, so
 * one spec covers every route the server answers. Returns a new document.
 *
 * Better Auth describes itself, not this app, so four things are corrected:
 *   - its paths are relative to its basePath and get the /api/v1/auth prefix;
 *   - it marks every operation, sign-up included, as needing a bearer token,
 *     and the bearer plugin is not enabled here. Each endpoint decides for
 *     itself whether it needs a session, and its metadata does not say, so the
 *     session cookie is documented as optional rather than guessed at;
 *   - its error bodies are `{ message }`, but the after-hook in auth.config.ts
 *     rewrites every auth error into the coded envelope;
 *   - its tags become an "Auth" family beside our own.
 */
export function mergeAuthDocument(
  document: OpenAPIObject,
  auth: AuthOpenApiDocument,
  basePath: string,
): OpenAPIObject {
  const paths = { ...document.paths };
  for (const [path, item] of Object.entries(auth.paths)) {
    paths[`${basePath}${path}`] = rewritePathItem(item);
  }

  const schemas = { ...document.components?.schemas };
  for (const [name, schema] of Object.entries(auth.components?.schemas ?? {})) {
    if (name in schemas) {
      throw new Error(`OpenAPI schema "${name}" is defined by both the API and Better Auth`);
    }
    schemas[name] = schema as NonNullable<typeof schemas>[string];
  }

  return { ...document, paths, components: { ...document.components, schemas } };
}

function rewritePathItem(item: object): PathItemObject {
  const rewritten: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(item)) {
    rewritten[key] = HTTP_METHODS.has(key) ? rewriteOperation(value as OperationObject) : value;
  }
  return rewritten as PathItemObject;
}

function rewriteOperation(operation: OperationObject): OperationObject {
  const responses: OperationObject['responses'] = {};
  for (const [status, response] of Object.entries(operation.responses ?? {})) {
    responses[status] =
      response && Number(status) >= 400 && 'description' in response
        ? {
            description: response.description,
            content: { 'application/json': { schema: { $ref: ERROR_RESPONSE_REF } } },
          }
        : response;
  }

  return {
    ...operation,
    tags: (operation.tags ?? []).map((tag) => TAG_RENAMES[tag] ?? `Auth: ${tag}`),
    security: [{}, { [SESSION_COOKIE_SCHEME]: [] }],
    responses,
  };
}
