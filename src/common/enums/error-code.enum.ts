/**
 * Error codes for categorizing different types of failures
 * Used in error responses to provide machine-readable error classification
 */
export enum ErrorCode {
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  TIMEOUT_ERROR = 'TIMEOUT_ERROR',
  NETWORK_ERROR = 'NETWORK_ERROR',
  RATE_LIMIT_ERROR = 'RATE_LIMIT_ERROR',
  PLATFORM_ERROR = 'PLATFORM_ERROR',
  AUTH_ERROR = 'AUTH_ERROR',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}
