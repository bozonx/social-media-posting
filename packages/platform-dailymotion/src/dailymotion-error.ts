import { ErrorCode, PlatformError } from '@bozonx/social-posting';

/** The JSON body Dailymotion returns on a failure. */
export interface DailymotionErrorBody {
  error?: {
    code?: number;
    message?: string;
    type?: string;
  };
  /** The OAuth endpoints answer in RFC 6749 shape instead. */
  error_description?: string;
}

/** Error types that mean the account has spent its upload allowance. */
const QUOTA_TYPES = new Set(['limit_reached_error', 'quota_exceeded_error']);

/** Error types that mean Dailymotion looked at the content and refused it. */
const CONTENT_TYPES = new Set([
  'invalid_parameter_error',
  'media_error',
  'moderation_error',
  'forbidden_content_error',
]);

/**
 * Translate a Dailymotion failure into the library's error contract.
 *
 * Dailymotion states the interesting part in `error.type` rather than in the
 * HTTP status: an exhausted daily upload allowance and a rejected file are both
 * a plain `400`, and only the type separates "try tomorrow" from "this file
 * will never be accepted".
 *
 * @param status - HTTP status of the failed response.
 * @param body - Parsed JSON error body, when there was one.
 * @param retryAfterHeader - The `retry-after` header, when present.
 * @returns The classified error to throw on.
 */
export function toPlatformError(
  status: number,
  body: DailymotionErrorBody | undefined,
  retryAfterHeader?: string | null,
): PlatformError {
  const error = body?.error;
  const type = error?.type;
  const message =
    error?.message ?? body?.error_description ?? `Dailymotion responded with ${status}`;

  const shared = {
    httpStatus: status,
    platformCode: type ?? String(error?.code ?? status),
    raw: { code: error?.code, type, message: error?.message },
  };

  const retryAfterMs = parseRetryAfter(retryAfterHeader);

  if (type !== undefined && QUOTA_TYPES.has(type)) {
    return new PlatformError(message, ErrorCode.QUOTA_EXCEEDED, {
      ...shared,
      retryable: true,
      retryAfterMs,
    });
  }

  if (status === 429) {
    return new PlatformError(message, ErrorCode.RATE_LIMIT_ERROR, {
      ...shared,
      retryable: true,
      retryAfterMs,
    });
  }

  if (status === 401 || type === 'auth_required_error' || type === 'invalid_token') {
    return new PlatformError(message, ErrorCode.AUTH_REFRESH_REQUIRED, {
      ...shared,
      retryable: false,
    });
  }

  if (status === 403) {
    // Uploading is gated by the account's status: a partner or verified account
    // may upload where an ordinary one may not, and no token fixes that.
    return new PlatformError(message, ErrorCode.AUTH_ERROR, { ...shared, retryable: false });
  }

  if (status === 413) {
    return new PlatformError(message, ErrorCode.CONTENT_REJECTED, { ...shared, retryable: false });
  }

  if (status >= 400 && status < 500) {
    return new PlatformError(
      message,
      type !== undefined && CONTENT_TYPES.has(type)
        ? ErrorCode.CONTENT_REJECTED
        : ErrorCode.VALIDATION_ERROR,
      { ...shared, retryable: false },
    );
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
