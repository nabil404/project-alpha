import type { OpenAPIObject, OperationObject, PathItemObject } from '@nestjs/swagger';
import { ERROR_RESPONSE_REF } from './api-coded-error';

export const SESSION_COOKIE_SCHEME = 'sessionCookie';

/** The parts of Better Auth's generated document this merge reads. */
export interface AuthOpenApiDocument {
  paths: Record<string, object>;
  components?: { schemas?: Record<string, object> };
}

const TAG_RENAMES: Record<string, string> = { Default: 'Auth' };
const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']);

/**
 * Merges Better Auth's generated document into ours and returns a new one,
 * correcting four things:
 *   - its paths get the /api/v1/auth prefix;
 *   - its bearer-token requirement becomes an optional session cookie, since
 *     the bearer plugin is off and its metadata does not say which endpoints
 *     need a session;
 *   - its errors are the coded envelope the after-hook in auth.config.ts
 *     produces, not `{ message }`;
 *   - its tags are grouped under "Auth".
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
