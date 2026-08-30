import { describe, expect, it } from 'vitest';
import { ErrorCode } from '@bozonx/social-posting';
import { toPlatformError } from '../src/index.js';
import errors from './fixtures/errors.json' with { type: 'json' };

describe('toPlatformError', () => {
  it('prefers the cool-down in the body over the header', () => {
    const error = toPlatformError(429, { retry_after: 1.5, message: 'slow down' }, '30');
    expect(error.code).toBe(ErrorCode.RATE_LIMIT_ERROR);
    expect(error.retryAfterMs).toBe(1_500);
    expect(error.retryable).toBe(true);
  });

  it('falls back to the header when the body carries no cool-down', () => {
    expect(toPlatformError(429, { message: 'slow down' }, '7').retryAfterMs).toBe(7_000);
  });

  it('treats a rejected token as unrecoverable rather than refreshable', () => {
    const error = toPlatformError(401, errors.unauthorized.body);
    expect(error.code).toBe(ErrorCode.AUTH_ERROR);
    expect(error.retryable).toBe(false);
  });

  it('says out loud that a 403 is a missing permission, not a bad token', () => {
    const error = toPlatformError(403, errors.missingPermissions.body);
    expect(error.code).toBe(ErrorCode.AUTH_ERROR);
    expect(error.message).toMatch(/lacks permission/);
  });

  it('separates content Discord refuses from a malformed request', () => {
    expect(toPlatformError(400, errors.attachmentTooLarge.body).code).toBe(
      ErrorCode.CONTENT_REJECTED,
    );
    expect(toPlatformError(400, { code: 10003, message: 'Unknown Channel' }).code).toBe(
      ErrorCode.VALIDATION_ERROR,
    );
  });

  it('classifies an oversized request body as refused content', () => {
    expect(toPlatformError(413, errors.payloadTooLarge.body).code).toBe(ErrorCode.CONTENT_REJECTED);
  });

  it('keeps an outage retryable', () => {
    const error = toPlatformError(503, errors.serverError.body);
    expect(error.code).toBe(ErrorCode.PLATFORM_ERROR);
    expect(error.retryable).toBe(true);
  });

  it("carries Discord's own numeric code, which differs from the HTTP status", () => {
    const error = toPlatformError(403, errors.missingPermissions.body);
    expect(error.platformCode).toBe('50013');
    expect(error.httpStatus).toBe(403);
  });

  it('survives a failure with no JSON body at all', () => {
    const error = toPlatformError(502, undefined);
    expect(error.code).toBe(ErrorCode.PLATFORM_ERROR);
    expect(error.message).toBe('Discord responded with 502');
  });
});
