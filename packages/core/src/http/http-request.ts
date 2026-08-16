import { ErrorCode } from '../errors/error-code.js';
import { PlatformError } from '../errors/platform-error.js';

/**
 * Options for {@link httpRequest}, on top of the standard `fetch` init.
 */
export interface HttpRequestOptions extends RequestInit {
  /**
   * Whether the request body may be sent twice.
   *
   * A connection that dies before any byte of the body left the process cannot
   * have been acted on, so re-sending is safe and saves the host a whole retry
   * cycle. Once a stream has been consumed there is nothing left to re-send,
   * so streamed bodies must set this to false.
   *
   * Defaults to true for bodies that can be replayed (no body, string,
   * `URLSearchParams`, `Blob`, typed array) and false for a `ReadableStream`.
   */
  replayableBody?: boolean;
}

/**
 * `fetch` with exactly one transport-level retry.
 *
 * This is the only retry anywhere in this library, and it is deliberately
 * narrow: it repeats a request whose connection failed *before* the request
 * completed, never one that failed after the platform may have seen it. A
 * request that reached the platform and came back as an error is the host's to
 * repeat, with the platform's own `retryAfterMs` in hand.
 *
 * @param url - Target URL.
 * @param options - Standard `fetch` init plus {@link HttpRequestOptions}.
 * @returns The platform's response, whatever its status.
 * @throws PlatformError classified as `NETWORK_ERROR` or `TIMEOUT_ERROR`.
 */
export async function httpRequest(
  url: string,
  options: HttpRequestOptions = {},
): Promise<Response> {
  const { replayableBody, ...init } = options;
  const canReplay = replayableBody ?? isReplayable(init.body);

  try {
    return await fetch(url, init);
  } catch (error) {
    if (init.signal?.aborted) {
      throw abortError(error, init.signal);
    }
    if (!canReplay) {
      throw networkError(error, url);
    }

    // One retry: the connection failed and the body can be sent again unchanged.
    try {
      return await fetch(url, init);
    } catch (retryError) {
      if (init.signal?.aborted) {
        throw abortError(retryError, init.signal);
      }
      throw networkError(retryError, url);
    }
  }
}

/**
 * Whether a body can be sent a second time byte for byte.
 * A `ReadableStream` cannot: reading it consumes it.
 */
function isReplayable(body: BodyInit | null | undefined): boolean {
  if (body === undefined || body === null) {
    return true;
  }
  return !(typeof ReadableStream !== 'undefined' && body instanceof ReadableStream);
}

/**
 * The connection itself failed, so the platform never answered: always worth
 * the host repeating.
 */
function networkError(cause: unknown, url: string): PlatformError {
  return new PlatformError(
    `Request to ${safeHost(url)} failed: ${(cause as Error)?.message ?? 'network error'}`,
    ErrorCode.NETWORK_ERROR,
    { retryable: true, cause },
  );
}

function abortError(cause: unknown, signal: AbortSignal): PlatformError {
  const timedOut = (signal.reason as { code?: ErrorCode })?.code === ErrorCode.TIMEOUT_ERROR;
  return new PlatformError(
    timedOut ? 'Request timed out' : 'Request aborted',
    timedOut ? ErrorCode.TIMEOUT_ERROR : ErrorCode.NETWORK_ERROR,
    { retryable: timedOut, cause },
  );
}

/** Host of a URL, so an error message never leaks a token in the path. */
function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'the platform';
  }
}
