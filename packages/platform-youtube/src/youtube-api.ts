import { ErrorCode, PlatformError } from '@bozonx/social-posting';
import { httpRequest } from '@bozonx/social-posting/platform';
import { toPlatformError } from './youtube-error.js';
import type { YouTubeErrorBody } from './youtube-error.js';

/** The Data API version this package speaks, pinned deliberately. */
export const API_VERSION = 'v3';

/** Default API root. Overridable per account through `apiBaseUrl`. */
export const DEFAULT_API_BASE_URL = 'https://www.googleapis.com';

/** The video resource, in the fields this adapter reads. */
export interface YouTubeVideo {
  id?: string;
  snippet?: { title?: string; channelId?: string };
  status?: {
    uploadStatus?: string;
    privacyStatus?: string;
    failureReason?: string;
    rejectionReason?: string;
  };
  processingDetails?: {
    processingStatus?: string;
    processingFailureReason?: string;
    processingProgress?: {
      partsTotal?: string | number;
      partsProcessed?: string | number;
      timeLeftMs?: string | number;
    };
  };
  [key: string]: unknown;
}

/** A `videos.list` page. */
export interface YouTubeVideoListResponse {
  items?: YouTubeVideo[];
}

export interface YouTubeJsonRequest {
  /** Absolute URL to call. */
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  accessToken: string;
  body?: Record<string, unknown> | FormData | Blob | Uint8Array;
  /** Content type for a raw body; ignored for JSON and `FormData`. */
  contentType?: string;
  signal?: AbortSignal;
}

/** Where a resumable session lives and how far it has got. */
export interface ResumableSession {
  /** The opaque `upload_id` Google issues. Not a secret in itself. */
  uploadId: string;
  /** The full session URL, rebuilt from `uploadId` when resuming. */
  url: string;
}

/**
 * The YouTube Data API over plain `fetch`.
 *
 * No `googleapis` package: it pulls in `google-auth-library`, `gaxios` and a
 * transitive tree that assumes Node, and it hides the HTTP status and the
 * `reason` string this library classifies failures by. The resumable protocol
 * is nine lines of `Content-Range` handling, which is less than the wrapper.
 */
export class YouTubeApi {
  private readonly baseUrl: string;
  private readonly timeoutMs?: number;
  private readonly fetch?: typeof fetch;

  constructor(options: { baseUrl?: string; timeoutSeconds?: number; fetch?: typeof fetch } = {}) {
    this.baseUrl = trimTrailingSlash(options.baseUrl ?? DEFAULT_API_BASE_URL);
    this.timeoutMs =
      options.timeoutSeconds === undefined ? undefined : options.timeoutSeconds * 1000;
    this.fetch = options.fetch;
  }

  /** Build a Data API URL, e.g. `/videos`. */
  endpoint(path: string, query: Record<string, string> = {}): string {
    return withQuery(`${this.baseUrl}/youtube/${API_VERSION}${path}`, query);
  }

  /** Build an upload endpoint URL, which lives under a different path prefix. */
  uploadEndpoint(path: string, query: Record<string, string> = {}): string {
    return withQuery(`${this.baseUrl}/upload/youtube/${API_VERSION}${path}`, query);
  }

  /**
   * Perform one API call that carries and expects JSON.
   *
   * @returns The parsed response, or undefined for a `204`.
   * @throws PlatformError classified by {@link toPlatformError}.
   */
  async call<T>(request: YouTubeJsonRequest): Promise<T | undefined> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${request.accessToken}`,
      accept: 'application/json',
    };

    let body: BodyInit | undefined;
    if (request.body instanceof FormData) {
      body = request.body;
    } else if (request.body instanceof Blob) {
      body = request.body;
      headers['content-type'] = request.contentType ?? 'application/octet-stream';
    } else if (request.body instanceof Uint8Array) {
      body = request.body as unknown as BodyInit;
      headers['content-type'] = request.contentType ?? 'application/octet-stream';
    } else if (request.body !== undefined) {
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
   * Open a resumable upload session.
   *
   * The metadata goes up first as JSON, and Google answers with a `Location`
   * that every subsequent chunk is written to. `X-Upload-Content-Length` is
   * what lets it reject an oversized file before a single byte is sent.
   *
   * @returns The session, addressed by its `upload_id`.
   */
  async initResumable(options: {
    metadata: Record<string, unknown>;
    accessToken: string;
    contentType: string;
    contentLength?: number;
    query: Record<string, string>;
    signal?: AbortSignal;
  }): Promise<ResumableSession> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${options.accessToken}`,
      'content-type': 'application/json; charset=UTF-8',
      'x-upload-content-type': options.contentType,
    };
    if (options.contentLength !== undefined) {
      headers['x-upload-content-length'] = String(options.contentLength);
    }

    const response = await this.send(
      this.uploadEndpoint('/videos', { ...options.query, uploadType: 'resumable' }),
      {
        method: 'POST',
        headers,
        body: JSON.stringify(options.metadata),
        signal: options.signal,
      },
    );

    if (!response.ok) {
      throw await errorFrom(response);
    }

    const location = response.headers.get('location');
    if (!location) {
      throw new PlatformError(
        'YouTube accepted the upload metadata but returned no resumable session location',
        ErrorCode.PLATFORM_ERROR,
        { retryable: true, httpStatus: response.status },
      );
    }

    return { uploadId: uploadIdOf(location), url: location };
  }

  /** Rebuild a session from the id a resume handle carried. */
  sessionFrom(uploadId: string): ResumableSession {
    return {
      uploadId,
      url: this.uploadEndpoint('/videos', { uploadType: 'resumable', upload_id: uploadId }),
    };
  }

  /**
   * Write one chunk into an open session.
   *
   * `308 Resume Incomplete` means the chunk landed and more is expected; a
   * `200` or `201` means this was the last one and carries the video resource.
   *
   * @returns The created video, once the final chunk completes the upload.
   */
  async putChunk(options: {
    session: ResumableSession;
    chunk: Uint8Array;
    offsetBytes: number;
    totalBytes?: number;
    accessToken: string;
    signal?: AbortSignal;
  }): Promise<YouTubeVideo | undefined> {
    const end = options.offsetBytes + options.chunk.byteLength - 1;
    const total = options.totalBytes === undefined ? '*' : String(options.totalBytes);

    const response = await this.send(options.session.url, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${options.accessToken}`,
        'content-range': `bytes ${options.offsetBytes}-${end}/${total}`,
        'content-type': 'application/octet-stream',
      },
      body: options.chunk as unknown as BodyInit,
      // A chunk is addressed by its byte offset, so a repeat overwrites the
      // same range. It is still not replayed here: `runChunkedUpload` owns
      // chunk retries and knows what it already sent.
      replayableBody: false,
      signal: options.signal,
    });

    if (response.status === 308) {
      // Body is empty; the useful part is the `Range` header, which the caller
      // reads only when it has to resynchronize.
      await response.body?.cancel();
      return undefined;
    }

    if (!response.ok) {
      throw await errorFrom(response);
    }

    return (await response.json().catch(() => undefined)) as YouTubeVideo | undefined;
  }

  /**
   * Ask an open session how much of the file it already holds.
   *
   * This is the answer to an interrupted upload whose local offset cannot be
   * trusted: an empty `PUT` with `Content-Range: bytes *\/TOTAL` returns the
   * highest byte Google actually stored. Resuming from a guessed offset is how
   * a file ends up corrupt.
   *
   * @returns The next byte to send, or the finished video when it is complete.
   */
  async queryPosition(options: {
    session: ResumableSession;
    totalBytes: number;
    accessToken: string;
    signal?: AbortSignal;
  }): Promise<{ status: 'incomplete'; offsetBytes: number } | { status: 'complete' }> {
    const response = await this.send(options.session.url, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${options.accessToken}`,
        'content-range': `bytes */${options.totalBytes}`,
        'content-length': '0',
      },
      signal: options.signal,
    });

    if (response.status === 308) {
      const range = response.headers.get('range');
      await response.body?.cancel();
      // No `Range` at all means nothing was stored: start from zero.
      const lastByte = range === null ? -1 : Number(range.split('-')[1] ?? -1);
      return {
        status: 'incomplete',
        offsetBytes: Number.isFinite(lastByte) && lastByte >= 0 ? lastByte + 1 : 0,
      };
    }

    if (response.ok) {
      await response.body?.cancel();
      return { status: 'complete' };
    }

    throw await errorFrom(response);
  }

  private send(url: string, init: RequestInit & { replayableBody?: boolean }): Promise<Response> {
    return httpRequest(url, {
      ...init,
      signal: this.withTimeout(init.signal ?? undefined),
      fetch: this.fetch,
    });
  }

  /** Combine the caller's signal with the account's own API timeout. */
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
  const parsed = (await response.json().catch(() => undefined)) as YouTubeErrorBody | undefined;
  return toPlatformError(response.status, parsed, response.headers.get('retry-after'));
}

/**
 * The session id inside a `Location`.
 *
 * Kept rather than the whole URL because a resume handle is stored by the host
 * and must survive being read: the id addresses the session without carrying
 * the query string Google signs it with.
 */
function uploadIdOf(location: string): string {
  try {
    return new URL(location).searchParams.get('upload_id') ?? location;
  } catch {
    return location;
  }
}

function withQuery(url: string, query: Record<string, string>): string {
  const entries = Object.entries(query).filter(([, value]) => value !== '');
  if (entries.length === 0) {
    return url;
  }
  const search = new URLSearchParams(entries);
  return `${url}?${search.toString()}`;
}

function trimTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}
