import { errorResponseBodySchema } from '@app/shared';
import { ApiError } from './api-error';

/** Same-origin API client: Caddy proxies /api to the NestJS app, which serves /api/v1. */
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...init?.headers },
  });

  if (!response.ok) {
    throw await toApiError(response);
  }

  return (await response.json()) as T;
}

/**
 * Never assume the envelope is there. A 502 from Caddy is an HTML page, and a
 * proxy can fail before the API is reached at all, so an unparseable body
 * still becomes an ApiError — just one carrying the HTTP_<status> fallback.
 */
async function toApiError(response: Response): Promise<ApiError> {
  const fallback = new ApiError(
    response.status,
    `HTTP_${response.status}`,
    `${response.status} ${response.statusText}`,
  );

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return fallback;
  }

  const parsed = errorResponseBodySchema.safeParse(body);
  if (!parsed.success) {
    return fallback;
  }

  const { code, message, params, fields } = parsed.data.error;
  return new ApiError(response.status, code, message, params, fields ?? {});
}
