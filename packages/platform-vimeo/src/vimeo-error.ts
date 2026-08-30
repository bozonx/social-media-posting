import { ErrorCode, PlatformError } from '@bozonx/social-posting';

/** The JSON body Vimeo returns on a failure. */
export interface VimeoErrorBody {
  error?: string;
  /** Vimeo's own numeric code, distinct from the HTTP status. */
  error_code?: number;
  developer_message?: string;
  link?: string | null;
  invalid_parameters?: Array<{ field?: string; error?: string; error_code?: number }>;
}

/**
 * Vimeo error codes that mean the account has no room or no allowance left.
 *
 * The reason this set exists separately from rate limiting: Vimeo's limit is
 * storage and a periodic upload allowance, not an operation count. "Free up
 * space or upgrade the plan" and "try again in a minute" are different
 * instructions to a user, and both arrive as a 4xx.
 */
const QUOTA_CODES = new Set([
  4101, // The user has reached their upload quota
  4102, // The user does not have enough space
  4103, // The user has reached their periodic upload quota
]);

/**
 * Translate a Vimeo failure into the library's error contract.
 *
 * @param status - HTTP status of the failed response.
 * @param body - Parsed JSON error body, when there was one.
 * @param retryAfterHeader - The `retry-after` header, when present.
 * @returns The classified error to throw on.
 */
export function toPlatformError(
  status: number,
  body: VimeoErrorBody | undefined,
  retryAfterHeader?: string | null,
): PlatformError {
  const message = body?.error ?? body?.developer_message ?? `Vimeo responded with ${status}`;
  const code = body?.error_code;

  const shared = {
    httpStatus: status,
    platformCode: code === undefined ? String(status) : String(code),
    raw: {
      error: body?.error,
      error_code: code,
      developer_message: body?.developer_message,
      invalid_parameters: body?.invalid_parameters,
    },
  };

  const retryAfterMs = parseRetryAfter(retryAfterHeader);

  if (code !== undefined && QUOTA_CODES.has(code)) {
    // Not retryable on any timescale a queue would choose: storage does not
    // free itself, and the periodic allowance resets on the account's own
    // billing cycle rather than at a time the API states.
    return new PlatformError(message, ErrorCode.QUOTA_EXCEEDED, {
      ...shared,
      retryable: false,
    });
  }

  if (status === 429) {
    return new PlatformError(message, ErrorCode.RATE_LIMIT_ERROR, {
      ...shared,
      retryable: true,
      retryAfterMs,
    });
  }

  if (status === 401) {
    return new PlatformError(message, ErrorCode.AUTH_REFRESH_REQUIRED, {
      ...shared,
      retryable: false,
    });
  }

  if (status === 403) {
    // Uploading is gated by the account's plan, and no scope change fixes a
    // Basic account that has run out of weekly allowance.
    return new PlatformError(message, ErrorCode.AUTH_ERROR, { ...shared, retryable: false });
  }

  if (status === 404 || status === 400 || status === 422) {
    return new PlatformError(
      message,
      status === 422 ? ErrorCode.CONTENT_REJECTED : ErrorCode.VALIDATION_ERROR,
      { ...shared, retryable: false },
    );
  }

  if (status === 413) {
    return new PlatformError(message, ErrorCode.CONTENT_REJECTED, { ...shared, retryable: false });
  }

  if (status >= 500) {
    return new PlatformError(message, ErrorCode.PLATFORM_ERROR, {
      ...shared,
      retryable: true,
      retryAfterMs,
    });
  }

  return new PlatformError(message, ErrorCode.PLATFORM_ERROR, { ...shared, retryable: false });
}

/** `retry-after` in either of its two documented forms. */
function parseRetryAfter(header?: string | null): number | undefined {
  if (header === null || header === undefined || header === '') {
    return undefined;
  }
  const seconds = Number(header);
  if (Number.isFinite(seconds)) {
    return Math.max(0, Math.ceil(seconds * 1000));
  }
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}
