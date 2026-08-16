/**
 * Machine-readable classification of a failure.
 *
 * The host decides what to do from this code plus `retryable` and
 * `retryAfterMs` on the error — it never has to parse a message.
 */
export enum ErrorCode {
  /** The request is malformed or violates a rule known before the call. Never retryable. */
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  /** The operation did not finish within the configured request timeout. */
  TIMEOUT_ERROR = 'TIMEOUT_ERROR',
  /** The platform could not be reached at all. */
  NETWORK_ERROR = 'NETWORK_ERROR',
  /** The platform asked the caller to slow down; see `retryAfterMs`. */
  RATE_LIMIT_ERROR = 'RATE_LIMIT_ERROR',
  /** The platform answered with an error that is neither auth nor rate limiting. */
  PLATFORM_ERROR = 'PLATFORM_ERROR',
  /** Credentials are missing, malformed or rejected. */
  AUTH_ERROR = 'AUTH_ERROR',
  /**
   * The credentials expired and cannot be refreshed without the user.
   * The host should flag the channel for re-authorization instead of retrying.
   */
  AUTH_REFRESH_REQUIRED = 'AUTH_REFRESH_REQUIRED',
  /** Moderation or policy rejected the content. Retrying the same content will not help. */
  CONTENT_REJECTED = 'CONTENT_REJECTED',
  /** A per-period quota (daily post limit, upload volume) is exhausted. */
  QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',
  /** Unexpected failure inside this library. */
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}
