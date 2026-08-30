import { httpRequest } from '@bozonx/social-posting/platform';
import { toPlatformError } from './discord-error.js';
import type { DiscordErrorBody } from './discord-error.js';

/** The API version this package speaks, pinned deliberately. */
export const API_VERSION = 'v10';

/** Default API root. Overridable per account through `apiBaseUrl`. */
export const DEFAULT_API_BASE_URL = 'https://discord.com/api';

/** The message object Discord returns, in the fields this adapter reads. */
export interface DiscordMessage {
  id: string;
  channel_id: string;
  /** Present on webhook responses; absent on bot responses. */
  guild_id?: string;
  [key: string]: unknown;
}

/** How one request authorizes itself. */
export type DiscordAuthorization =
  | { kind: 'bot'; token: string }
  /** A webhook authorizes by its URL alone; there is no header. */
  | { kind: 'webhook' };

export interface DiscordRequest {
  /** Absolute URL to call. */
  url: string;
  method: 'POST' | 'DELETE' | 'GET' | 'PATCH';
  authorization: DiscordAuthorization;
  /** A JSON body, or a `FormData` when the message carries attachments. */
  body?: FormData | Record<string, unknown>;
  signal?: AbortSignal;
}

/**
 * Discord's REST API over plain `fetch`.
 *
 * No SDK: discord.js wraps the failure in its own class and loses the HTTP
 * status, Discord's own numeric code and the `retry_after` this library is
 * built on — and it will not run on Workers.
 */
export class DiscordApi {
  private readonly baseUrl: string;
  private readonly timeoutMs?: number;
  private readonly fetch?: typeof fetch;

  constructor(options: { baseUrl?: string; timeoutSeconds?: number; fetch?: typeof fetch } = {}) {
    this.baseUrl = trimTrailingSlash(options.baseUrl ?? DEFAULT_API_BASE_URL);
    this.timeoutMs =
      options.timeoutSeconds === undefined ? undefined : options.timeoutSeconds * 1000;
    this.fetch = options.fetch;
  }

  /** Build an absolute URL for an API path such as `/channels/1/messages`. */
  endpoint(path: string): string {
    return `${this.baseUrl}/${API_VERSION}${path}`;
  }

  /**
   * Perform one API call.
   *
   * @param request - Target, method, authorization and body.
   * @returns The parsed JSON response, or undefined for a `204`.
   * @throws PlatformError classified by {@link toPlatformError}.
   */
  async call<T>(request: DiscordRequest): Promise<T | undefined> {
    const headers: Record<string, string> = {};
    if (request.authorization.kind === 'bot') {
      headers.authorization = `Bot ${request.authorization.token}`;
    }

    let body: BodyInit | undefined;
    if (request.body instanceof FormData) {
      // Never set content-type by hand for FormData: the boundary is generated
      // by the runtime and a hand-written header loses it.
      body = request.body;
    } else if (request.body !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(request.body);
    }

    const response = await httpRequest(request.url, {
      method: request.method,
      headers,
      body,
      // An attachment upload is a one-shot stream and a mutating call: it must
      // never be replayed behind the caller's back.
      replayableBody: !(request.body instanceof FormData),
      signal: this.withTimeout(request.signal),
      fetch: this.fetch,
    });

    if (!response.ok) {
      const parsed = (await response.json().catch(() => undefined)) as DiscordErrorBody | undefined;
      throw toPlatformError(response.status, parsed, response.headers.get('retry-after'));
    }

    if (response.status === 204) {
      return undefined;
    }

    return (await response.json().catch(() => undefined)) as T | undefined;
  }

  /** Combine the caller's signal with the account's own API timeout. */
  private withTimeout(signal?: AbortSignal): AbortSignal | undefined {
    if (this.timeoutMs === undefined) {
      return signal;
    }
    const timeout = AbortSignal.timeout(this.timeoutMs);
    return signal ? AbortSignal.any([signal, timeout]) : timeout;
  }
}

function trimTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}
