import { ErrorCode, PlatformError } from '@bozonx/social-posting';
import { buildMultipartFormData, httpRequest } from '@bozonx/social-posting/platform';
import { toPlatformError } from './dailymotion-error.js';
import type { DailymotionErrorBody } from './dailymotion-error.js';

/** Default API root. Overridable per account through `apiBaseUrl`. */
export const DEFAULT_API_BASE_URL = 'https://api.dailymotion.com';

/** Where refreshed tokens come from. */
export const TOKEN_ENDPOINT = 'https://api.dailymotion.com/oauth/token';

/** The video resource, in the fields this adapter reads. */
export interface DailymotionVideo {
  id?: string;
  title?: string;
  url?: string;
  /** `processing`, `published`, `encoding_error`, `rejected`, `deleted`. */
  status?: string;
  encoding_progress?: number;
  /** Present when Dailymotion refused the file. */
  publishing_progress?: number;
  [key: string]: unknown;
}

/** The one-shot upload target `GET /file/upload` hands out. */
export interface UploadTicket {
  /** Signed URL the file is POSTed to. A bearer secret in URL form. */
  upload_url: string;
  progress_url?: string;
}

/** What the upload endpoint answers with once the file is in. */
export interface UploadedFile {
  /** The URL to hand to `videos.create` as the source of the video. */
  url?: string;
}

export interface DailymotionJsonRequest {
  url: string;
  method: 'GET' | 'POST' | 'DELETE';
  accessToken: string;
  /** Sent as `application/x-www-form-urlencoded`, which is what this API takes. */
  form?: Record<string, string>;
  signal?: AbortSignal;
}

/**
 * The Dailymotion Graph API over plain `fetch`.
 *
 * Two protocols in one client, as with every video network here: a
 * form-encoded JSON API, and a plain multipart POST to a signed upload host
 * that is not part of the API at all.
 */
export class DailymotionApi {
  private readonly baseUrl: string;
  private readonly timeoutMs?: number;
  private readonly fetch?: typeof fetch;

  constructor(options: { baseUrl?: string; timeoutSeconds?: number; fetch?: typeof fetch } = {}) {
    this.baseUrl = trimTrailingSlash(options.baseUrl ?? DEFAULT_API_BASE_URL);
    this.timeoutMs =
      options.timeoutSeconds === undefined ? undefined : options.timeoutSeconds * 1000;
    this.fetch = options.fetch;
  }

  /** Build an absolute URL for an API path such as `/me/videos`. */
  endpoint(path: string, query: Record<string, string> = {}): string {
    const url = `${this.baseUrl}${path}`;
    const entries = Object.entries(query).filter(([, value]) => value !== '');
    return entries.length === 0 ? url : `${url}?${new URLSearchParams(entries).toString()}`;
  }

  /**
   * Perform one API call.
   *
   * @returns The parsed response, or undefined for a `204`.
   * @throws PlatformError classified by {@link toPlatformError}.
   */
  async call<T>(request: DailymotionJsonRequest): Promise<T | undefined> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${request.accessToken}`,
      accept: 'application/json',
    };

    let body: BodyInit | undefined;
    if (request.form !== undefined) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(request.form).toString();
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
   * Ask for somewhere to put a file.
   *
   * The ticket is short-lived and single-use, which is why it is requested
   * immediately before the upload rather than kept anywhere.
   */
  async requestUploadTicket(accessToken: string, signal?: AbortSignal): Promise<UploadTicket> {
    const ticket = await this.call<UploadTicket>({
      url: this.endpoint('/file/upload'),
      method: 'GET',
      accessToken,
      signal,
    });

    if (!ticket?.upload_url) {
      throw new PlatformError('Dailymotion did not issue an upload URL', ErrorCode.PLATFORM_ERROR, {
        retryable: true,
      });
    }
    return ticket;
  }

  /**
   * Send the file to the signed upload host.
   *
   * The whole file goes in one `POST`: this endpoint has no offset protocol,
   * so an interrupted upload starts over. That is a real limit of the network
   * and not something an adapter can paper over — which is why the descriptor
   * does not claim resumability here.
   *
   * @returns The URL that identifies the uploaded file to `videos.create`.
   */
  async uploadFile(options: {
    uploadUrl: string;
    blob: Blob;
    fileName: string;
    signal?: AbortSignal;
  }): Promise<string> {
    const form = buildMultipartFormData([
      { name: 'file', content: options.blob, fileName: options.fileName },
    ]);

    const response = await this.send(options.uploadUrl, {
      method: 'POST',
      body: form,
      signal: options.signal,
    });

    if (!response.ok) {
      throw await errorFrom(response);
    }

    const uploaded = (await response.json().catch(() => undefined)) as UploadedFile | undefined;
    if (!uploaded?.url) {
      throw new PlatformError(
        'Dailymotion accepted the file but returned no URL for it',
        ErrorCode.UNKNOWN_OUTCOME,
        { retryable: false },
      );
    }
    return uploaded.url;
  }

  private send(url: string, init: RequestInit): Promise<Response> {
    return httpRequest(url, {
      ...init,
      replayableBody: init.method === 'GET',
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
  const parsed = (await response.json().catch(() => undefined)) as DailymotionErrorBody | undefined;
  return toPlatformError(response.status, parsed, response.headers.get('retry-after'));
}

function trimTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}
