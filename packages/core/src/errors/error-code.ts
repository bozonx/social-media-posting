/**
 * Error codes for categorizing different types of failures.
 * Used in error responses to provide machine-readable error classification.
 */
export enum ErrorCode {
  /** The request itself is malformed or violates platform rules known up front. */
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  /** The operation did not finish within the configured request timeout. */
  TIMEOUT_ERROR = 'TIMEOUT_ERROR',
  /** The platform could not be reached at all. */
  NETWORK_ERROR = 'NETWORK_ERROR',
  /** The platform asked the caller to slow down. */
  RATE_LIMIT_ERROR = 'RATE_LIMIT_ERROR',
  /** The platform answered with an error that is neither auth nor rate limiting. */
  PLATFORM_ERROR = 'PLATFORM_ERROR',
  /** Credentials are missing, malformed or rejected. */
  AUTH_ERROR = 'AUTH_ERROR',
  /** Unexpected failure inside this library. */
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}
