import { ErrorCode } from '../errors/error-code.js';
import { PlatformError } from '../errors/platform-error.js';

/**
 * Options for {@link httpRequest}, on top of the standard `fetch` init.
 */
export interface HttpRequestOptions extends RequestInit {
  /**
   * Whether an idempotent request body may be sent twice.
   *
   * This never makes a mutating method retryable. Once a stream has been
   * consumed there is nothing left to re-send, so streamed bodies must set
   * this to false.
   *
   * Defaults to true for bodies that can be replayed (no body, string,
   * `URLSearchParams`, `Blob`, typed array) and false for a `ReadableStream`.
   */
  replayableBody?: boolean;
}

/**
 * `fetch` with at most one transport-level retry for idempotent methods.
 *
 * This is the only retry anywhere in this library, and it is deliberately
 * narrow: it repeats only an idempotent method with a replayable body. A fetch
 * rejection does not reveal whether a mutating request reached the platform,
 * so POST and PATCH are never repeated. A platform response is also the host's
 * to handle, with the platform's own `retryAfterMs` in hand.
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
  const canRetry = isIdempotent(init.method) && (replayableBody ?? isReplayable(init.body));

  try {
    return await fetch(url, init);
  } catch (error) {
    if (init.signal?.aborted) {
      throw abortError(error, init.signal);
    }
    if (!canRetry) {
      throw networkError(error, url);
    }

    // A fetch rejection cannot prove whether a mutating request reached the
    // platform. Only idempotent methods are safe to repeat here.
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

function isIdempotent(method: string | undefined): boolean {
  return ['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE'].includes((method ?? 'GET').toUpperCase());
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
  const reason = signal.reason as { code?: ErrorCode; name?: string } | undefined;
  const timedOut = reason?.code === ErrorCode.TIMEOUT_ERROR || reason?.name === 'TimeoutError';
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
