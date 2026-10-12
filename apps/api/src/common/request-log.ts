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
 * The request fields that reach the logs, listed explicitly. pino-http's
 * `query` and `params` hold the same credentials redactUrl masks in the URL,
 * but parsed, where no redact path reaches them, so they stay out. Headers are
 * kept, and the `redact` list in app.module.ts masks the secret ones.
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
