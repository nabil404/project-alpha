import { redactUrl } from './redact-url';

/** What pino-http's standard serializer hands the `req` serializer. */
export interface SerializedRequest {
  id?: unknown;
  method?: string;
  url?: string;
  query?: unknown;
  params?: unknown;
  headers?: Record<string, unknown>;
  remoteAddress?: string;
  remotePort?: number;
}

/**
 * The request fields that reach the logs, listed rather than spread: pino-http
 * also passes `query` and `params`, which carry the same credentials redactUrl
 * masks in the URL - an OAuth `code` and `state`, Meta's `hub.verify_token` -
 * but parsed, where no redact path reaches them. A new field stays out until
 * someone adds it here on purpose. Headers are kept; the `redact` list in
 * app.module.ts masks the secret-bearing ones.
 */
export function serializeRequest(req: SerializedRequest) {
  return {
    id: req.id,
    method: req.method,
    url: req.url === undefined ? undefined : redactUrl(req.url),
    headers: req.headers,
    remoteAddress: req.remoteAddress,
    remotePort: req.remotePort,
  };
}
