import { ErrorCode, PlatformError } from '@bozonx/social-posting';
import { httpRequest } from '@bozonx/social-posting/platform';
import { toPlatformError } from './vimeo-error.js';
import type { VimeoErrorBody } from './vimeo-error.js';

/** The API version this package pins, sent in the `Accept` header. */
export const API_VERSION = '3.4';

/** Default API root. Overridable per account through `apiBaseUrl`. */
export const DEFAULT_API_BASE_URL = 'https://api.vimeo.com';

/** The tus protocol version this adapter speaks. */
export const TUS_VERSION = '1.0.0';

/** The video resource, in the fields this adapter reads. */
export interface VimeoVideo {
  /** Canonical resource path, e.g. `/videos/123456789`. */
  uri?: string;
  name?: string;
  link?: string;
  /** `available` once Vimeo finished with the file. */
  status?: string;
  transcode?: { status?: string };
  upload?: {
    status?: string;
    approach?: string;
    size?: string | number;
    /** Where tus bytes go. Re-read rather than stored: it is a bearer URL. */
    upload_link?: string;
  };
  [key: string]: unknown;
}

/** What `/me` reports about the account's remaining room. */
export interface VimeoUploadQuota {
  space?: { free?: number; max?: number; used?: number; showing?: string };
  periodic?: { free?: number; max?: number; used?: number; reset_date?: string };
  lifetime?: { free?: number; max?: number; used?: number };
}

export interface VimeoJsonRequest {
  /** Absolute URL, or a resource path such as `/me/videos`. */
  url: string;
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  accessToken: string;
  body?: Record<string, unknown>;
  signal?: AbortSignal;
}

/**
 * Vimeo's REST API and its tus upload endpoint over plain `fetch`.
 *
 * The two are genuinely different protocols against different hosts: the REST
 * API answers JSON at `api.vimeo.com` with a versioned `Accept` header, while
 * the upload link is a tus endpoint that speaks in headers and returns no body
 * at all. Wrapping both in one client keeps the account's timeout and custom
 * `fetch` applying to the upload as well as to the metadata call.
 */
export class VimeoApi {
  private readonly baseUrl: string;
  private readonly timeoutMs?: number;
  private readonly fetch?: typeof fetch;

  constructor(options: { baseUrl?: string; timeoutSeconds?: number; fetch?: typeof fetch } = {}) {
    this.baseUrl = trimTrailingSlash(options.baseUrl ?? DEFAULT_API_BASE_URL);
    this.timeoutMs =
      options.timeoutSeconds === undefined ? undefined : options.timeoutSeconds * 1000;
    this.fetch = options.fetch;
  }

  /** Build an absolute URL from a resource path, passing absolute URLs through. */
  endpoint(path: string, query: Record<string, string> = {}): string {
    const url = /^https?:\/\//i.test(path) ? path : `${this.baseUrl}${path}`;
    const entries = Object.entries(query).filter(([, value]) => value !== '');
    if (entries.length === 0) {
      return url;
    }
    return `${url}?${new URLSearchParams(entries).toString()}`;
  }

  /**
   * Perform one REST call.
   *
   * @returns The parsed response, or undefined for a `204`.
   * @throws PlatformError classified by {@link toPlatformError}.
   */
  async call<T>(request: VimeoJsonRequest): Promise<T | undefined> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${request.accessToken}`,
      // Vimeo versions its API through `Accept`, not through the path. Without
      // this the account gets whatever the current default is, which changes.
      accept: `application/vnd.vimeo.*+json;version=${API_VERSION}`,
    };

    let body: BodyInit | undefined;
    if (request.body !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(request.body);
    }

    const response = await this.send(request.url, {
      method: request.method,
      headers,
      body,
      signal: request.signal,
    });

    if (!response.ok) {
      throw await errorFrom(response);
    }
    if (response.status === 204) {
      return undefined;
    }
    return (await response.json().catch(() => undefined)) as T | undefined;
  }

  /**
   * Ask a tus endpoint how many bytes it already holds.
   *
   * The authoritative answer to "where did the interrupted upload stop". A
   * locally remembered offset is a guess: the last `PATCH` may have landed
   * after the process recording it died.
   */
  async tusOffset(uploadLink: string, signal?: AbortSignal): Promise<number> {
    const response = await this.send(uploadLink, {
      method: 'HEAD',
      headers: { 'tus-resumable': TUS_VERSION },
      signal,
    });

    if (!response.ok) {
      throw await errorFrom(response);
    }

    const offset = Number(response.headers.get('upload-offset'));
    if (!Number.isFinite(offset) || offset < 0) {
      throw new PlatformError(
        'The Vimeo upload endpoint answered without a usable Upload-Offset',
        ErrorCode.PLATFORM_ERROR,
        { retryable: true, httpStatus: response.status },
      );
    }
    return offset;
  }

  /**
   * Write one chunk into a tus endpoint.
   *
   * @returns The offset the server holds after the write.
   */
  async tusPatch(options: {
    uploadLink: string;
    chunk: Uint8Array;
    offsetBytes: number;
    signal?: AbortSignal;
  }): Promise<number> {
    const response = await this.send(options.uploadLink, {
      method: 'PATCH',
      headers: {
        'tus-resumable': TUS_VERSION,
        'upload-offset': String(options.offsetBytes),
        'content-type': 'application/offset+octet-stream',
      },
      body: options.chunk as unknown as BodyInit,
      signal: options.signal,
    });

    if (response.status === 409) {
      // The offset we sent is not the offset the server holds. Resynchronizing
      // is the caller's job; writing anyway would corrupt the file.
      const held = response.headers.get('upload-offset');
      await response.body?.cancel();
      throw new PlatformError(
        `Vimeo holds ${held ?? 'a different number of'} bytes, not the ${options.offsetBytes} this chunk was written for`,
        ErrorCode.PLATFORM_ERROR,
        { retryable: false, httpStatus: 409 },
      );
    }

    if (!response.ok) {
      throw await errorFrom(response);
    }

    const next = Number(response.headers.get('upload-offset'));
    await response.body?.cancel();

    return Number.isFinite(next) ? next : options.offsetBytes + options.chunk.byteLength;
  }

  private send(url: string, init: RequestInit): Promise<Response> {
    return httpRequest(url, {
      ...init,
      // A chunk is one-shot bytes on a mutating method; the chunked uploader
      // owns retries and knows what it already wrote.
      replayableBody: init.method === 'GET' || init.method === 'HEAD',
      signal: this.withTimeout(init.signal ?? undefined),
      fetch: this.fetch,
    });
  }

  private withTimeout(signal?: AbortSignal | null): AbortSignal | undefined {
    if (this.timeoutMs === undefined) {
      return signal ?? undefined;
    }
    const timeout = AbortSignal.timeout(this.timeoutMs);
    return signal ? AbortSignal.any([signal, timeout]) : timeout;
  }
}

/** Read a failed response into a classified error. */
async function errorFrom(response: Response): Promise<PlatformError> {
  const parsed = (await response.json().catch(() => undefined)) as VimeoErrorBody | undefined;
  return toPlatformError(response.status, parsed, response.headers.get('retry-after'));
}

/** The numeric id inside a `/videos/123` URI. */
export function videoIdOf(uri: string | undefined): string | undefined {
  const id = uri?.split('/').filter(Boolean).pop();
  return id !== undefined && /^\d+$/.test(id) ? id : undefined;
}

function trimTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}
