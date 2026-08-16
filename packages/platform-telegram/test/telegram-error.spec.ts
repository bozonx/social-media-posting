import { describe, expect, it } from 'vitest';
import { ErrorCode, PlatformError } from '@bozonx/social-posting';
import { toPlatformError } from '../src/telegram-error.js';

/** The raw shape produced for a Bot API failure. */
function apiError(errorCode: number, description: string, parameters?: Record<string, unknown>) {
  return { error_code: errorCode, description, parameters, message: description };
}

describe('toPlatformError', () => {
  it('reads retry_after from a 429 and converts it to milliseconds', () => {
    const error = toPlatformError(
      apiError(429, 'Too Many Requests: retry after 30', { retry_after: 30 }),
    );

    expect(error.code).toBe(ErrorCode.RATE_LIMIT_ERROR);
    expect(error.retryable).toBe(true);
    expect(error.retryAfterMs).toBe(30_000);
    expect(error.httpStatus).toBe(429);
    expect(error.platformCode).toBe('429');
  });

  it('tolerates a 429 without retry_after', () => {
    const error = toPlatformError(apiError(429, 'Too Many Requests'));

    expect(error.code).toBe(ErrorCode.RATE_LIMIT_ERROR);
    expect(error.retryAfterMs).toBeUndefined();
  });

  it.each([
    [401, 'Unauthorized'],
    [403, 'Forbidden: bot was blocked by the user'],
  ])('classifies %i as a non-retryable auth error', (status, description) => {
    const error = toPlatformError(apiError(status, description));

    expect(error.code).toBe(ErrorCode.AUTH_ERROR);
    expect(error.retryable).toBe(false);
  });

  it('classifies a plain 400 as a validation error', () => {
    const error = toPlatformError(apiError(400, 'Bad Request: chat not found'));

    expect(error.code).toBe(ErrorCode.VALIDATION_ERROR);
    expect(error.retryable).toBe(false);
  });

  it('classifies a rejected file as CONTENT_REJECTED', () => {
    const error = toPlatformError(apiError(400, 'Bad Request: PHOTO_INVALID_DIMENSIONS'));

    expect(error.code).toBe(ErrorCode.CONTENT_REJECTED);
    expect(error.retryable).toBe(false);
  });

  it('classifies a 5xx as a retryable platform error', () => {
    const error = toPlatformError(apiError(502, 'Bad Gateway'));

    expect(error.code).toBe(ErrorCode.PLATFORM_ERROR);
    expect(error.retryable).toBe(true);
  });

  it('classifies a failure that never reached Telegram as a network error', () => {
    const error = toPlatformError(new TypeError('fetch failed'));

    expect(error.code).toBe(ErrorCode.NETWORK_ERROR);
    expect(error.retryable).toBe(true);
  });

  it('passes an already-classified error through', () => {
    const original = new PlatformError('nope', ErrorCode.QUOTA_EXCEEDED, { retryable: false });

    expect(toPlatformError(original)).toBe(original);
  });

  it('keeps the raw Bot API payload for logging', () => {
    const error = toPlatformError(
      apiError(429, 'Too Many Requests: retry after 5', { retry_after: 5 }),
    );

    expect(error.raw).toMatchObject({ parameters: { retry_after: 5 } });
  });
});
