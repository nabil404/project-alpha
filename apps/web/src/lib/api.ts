import { errorResponseBodySchema } from '@app/shared';
import { ApiError } from './api-error';

/** Same-origin API client: Caddy proxies /api to the NestJS app, which serves /api/v1. */
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  // A FormData body needs the browser's own multipart content type, boundary
  // included; setting JSON here would overwrite it and the upload would not parse.
  const isFormData = init?.body instanceof FormData;

  const response = await fetch(`/api/v1${path}`, {
    ...init,
    credentials: 'include',
    headers: isFormData ? init?.headers : { 'content-type': 'application/json', ...init?.headers },
  });

  if (!response.ok) {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = undefined;
    }
    throw toApiError(response.status, response.statusText, body);
  }

  // 204 has no body to parse; callers of a 204 route type T as void.
  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export interface UploadOptions {
  /** 0 to 1, as the request body leaves the browser. */
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

/**
 * A multipart POST that reports upload progress, which fetch can't. Same
 * origin, cookie and error envelope as apiFetch. An abort rejects with a
 * DOMException named AbortError, as fetch does.
 */
export function apiUpload<T>(
  path: string,
  body: FormData,
  options: UploadOptions = {},
): Promise<T> {
  const { onProgress, signal } = options;

  return new Promise<T>((resolve, reject) => {
    const abortError = () => new DOMException('The upload was cancelled', 'AbortError');
    if (signal?.aborted) {
      reject(abortError());
      return;
    }

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/v1${path}`);
    xhr.withCredentials = true;
    xhr.responseType = 'text';

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total);
    };
    xhr.onload = () => {
      const parsed = parseJson(xhr.responseText);
      if (xhr.status >= 200 && xhr.status < 300) resolve(parsed as T);
      else reject(toApiError(xhr.status, xhr.statusText, parsed));
    };
    // Network failure: no status, like fetch's TypeError.
    xhr.onerror = () => reject(new TypeError('Network request failed'));
    xhr.onabort = () => reject(abortError());
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });

    xhr.send(body);
  });
}

function parseJson(text: string): unknown {
  try {
    return text ? JSON.parse(text) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Never assume the envelope is there. A 502 from Caddy is an HTML page, and a
 * proxy can fail before the API is reached at all, so an unparseable body
 * still becomes an ApiError — just one carrying the HTTP_<status> fallback.
 */
function toApiError(status: number, statusText: string, body: unknown): ApiError {
  const parsed = errorResponseBodySchema.safeParse(body);
  if (!parsed.success) {
    return new ApiError(status, `HTTP_${status}`, `${status} ${statusText}`);
  }

  const { code, message, params, fields } = parsed.data.error;
  return new ApiError(status, code, message, params, fields ?? {});
}
