import { ErrorCode, PlatformError } from '@bozonx/social-posting';

/** The JSON body Discord returns on a failure. */
export interface DiscordErrorBody {
  /** Discord's own error code, distinct from the HTTP status. */
  code?: number;
  message?: string;
  /** Present on 429; seconds, fractional. */
  retry_after?: number;
  global?: boolean;
  errors?: unknown;
}

/**
 * Discord JSON error codes that mean the content itself was refused, rather
 * than the request being malformed.
 */
const CONTENT_REJECTED_CODES = new Set([
  40005, // Request entity too large
  50006, // Cannot send an empty message
  50035, // Invalid form body — includes attachment and embed validation
  50045, // File uploaded exceeds the maximum size
  50046, // Invalid file uploaded
]);

/** Discord JSON error codes that mean the bot lacks rights, not credentials. */
const PERMISSION_CODES = new Set([
  50001, // Missing access
  50013, // Missing permissions
]);

/**
 * Translate a Discord failure into the library's error contract.
 *
 * The only place Discord's vocabulary is read. The distinction that matters to
 * a host is between a token it should re-authorize, a permission a human must
 * grant in the server, and content Discord will never accept — all three are
 * 4xx, and treating them alike fills a queue with jobs that can never drain.
 *
 * @param status - HTTP status of the failed response.
 * @param body - Parsed JSON error body, when there was one.
 * @param retryAfterHeader - The `retry-after` header, when present.
 * @returns The classified error to throw on.
 */
export function toPlatformError(
  status: number,
  body: DiscordErrorBody | undefined,
  retryAfterHeader?: string | null,
): PlatformError {
  const message = body?.message ?? `Discord responded with ${status}`;
  const platformCode = body?.code === undefined ? String(status) : String(body.code);

  const shared = {
    httpStatus: status,
    platformCode,
    raw: { code: body?.code, message: body?.message, errors: body?.errors },
  };

  if (status === 429) {
    // Discord states the cool-down in fractional seconds, in the body and in
    // the header. The body is authoritative when both are present.
    const fromBody = typeof body?.retry_after === 'number' ? body.retry_after : undefined;
    const fromHeader = retryAfterHeader === null ? undefined : Number(retryAfterHeader);
    const seconds = fromBody ?? (Number.isFinite(fromHeader) ? fromHeader : undefined);

    return new PlatformError(message, ErrorCode.RATE_LIMIT_ERROR, {
      ...shared,
      retryable: true,
      retryAfterMs: seconds === undefined ? undefined : Math.ceil(seconds * 1000),
    });
  }

  if (status === 401) {
    // Bot tokens and webhook tokens are static: a rejected one is wrong, not
    // stale, so re-running an OAuth refresh would achieve nothing.
    return new PlatformError(message, ErrorCode.AUTH_ERROR, { ...shared, retryable: false });
  }

  if (status === 403) {
    return new PlatformError(
      PERMISSION_CODES.has(body?.code ?? -1)
        ? `${message} (the bot lacks permission in this channel)`
        : message,
      ErrorCode.AUTH_ERROR,
      { ...shared, retryable: false },
    );
  }

  if (status === 404) {
    // An unknown channel or a deleted webhook: the address is wrong, and no
    // amount of retrying makes it right.
    return new PlatformError(message, ErrorCode.VALIDATION_ERROR, { ...shared, retryable: false });
  }

  if (status === 413) {
    return new PlatformError(message, ErrorCode.CONTENT_REJECTED, { ...shared, retryable: false });
  }

  if (status >= 400 && status < 500) {
    const rejected = CONTENT_REJECTED_CODES.has(body?.code ?? -1);
    return new PlatformError(
      message,
      rejected ? ErrorCode.CONTENT_REJECTED : ErrorCode.VALIDATION_ERROR,
      { ...shared, retryable: false },
    );
  }

  if (status >= 500) {
    return new PlatformError(message, ErrorCode.PLATFORM_ERROR, { ...shared, retryable: true });
  }

  return new PlatformError(message, ErrorCode.NETWORK_ERROR, { ...shared, retryable: true });
}
