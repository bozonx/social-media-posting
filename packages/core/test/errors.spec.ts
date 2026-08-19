import { describe, expect, it } from 'vitest';
import { ErrorCode } from '../src/errors/error-code.js';
import { AbortedError, PostingError, ValidationError } from '../src/errors/posting-error.js';
import { PlatformError } from '../src/errors/platform-error.js';

describe('PostingError hierarchy', () => {
  describe('PostingError base class', () => {
    it('sets code, retryable, name, and cause properties', () => {
      const cause = new Error('root cause');
      const error = new PostingError('Something failed', ErrorCode.INTERNAL_ERROR, {
        retryable: true,
        cause,
      });

      expect(error.name).toBe('PostingError');
      expect(error.message).toBe('Something failed');
      expect(error.code).toBe(ErrorCode.INTERNAL_ERROR);
      expect(error.retryable).toBe(true);
      expect(error.cause).toBe(cause);
    });

    it('defaults retryable to false when omitted', () => {
      const error = new PostingError('Default retryable', ErrorCode.NETWORK_ERROR);
      expect(error.retryable).toBe(false);
    });
  });

  describe('ValidationError', () => {
    it('accepts a single string error message', () => {
      const error = new ValidationError('Field is required');

      expect(error.name).toBe('ValidationError');
      expect(error.code).toBe(ErrorCode.VALIDATION_ERROR);
      expect(error.retryable).toBe(false);
      expect(error.errors).toEqual(['Field is required']);
      expect(error.message).toBe('Field is required');
    });

    it('accepts an array of validation errors and joins with semicolons', () => {
      const errors = ['Field A is required', 'Field B must be positive'];
      const error = new ValidationError(errors);

      expect(error.errors).toEqual(errors);
      expect(error.message).toBe('Field A is required; Field B must be positive');
      expect(error.retryable).toBe(false);
    });

    it('preserves error cause when provided', () => {
      const cause = new TypeError('invalid type');
      const error = new ValidationError('Validation failed', { cause });

      expect(error.cause).toBe(cause);
    });
  });

  describe('AbortedError', () => {
    it('defaults to TIMEOUT_ERROR with retryable=true and default message', () => {
      const error = new AbortedError();

      expect(error.name).toBe('AbortedError');
      expect(error.message).toBe('Operation aborted');
      expect(error.code).toBe(ErrorCode.TIMEOUT_ERROR);
      expect(error.retryable).toBe(true);
    });

    it('supports custom message and non-timeout code (retryable=false)', () => {
      const error = new AbortedError('Client cancelled', ErrorCode.NETWORK_ERROR);

      expect(error.message).toBe('Client cancelled');
      expect(error.code).toBe(ErrorCode.NETWORK_ERROR);
      expect(error.retryable).toBe(false);
    });
  });

  describe('PlatformError', () => {
    it('stores platform-specific failure details', () => {
      const cause = new Error('http disconnect');
      const raw = { error_code: 429, description: 'Too Many Requests' };
      const resumeHandle = { platform: 'telegram', step: 'media-upload', state: { offset: 100 } };

      const error = new PlatformError('Rate limit exceeded', ErrorCode.RATE_LIMIT_ERROR, {
        retryable: true,
        retryAfterMs: 5000,
        httpStatus: 429,
        platformCode: '429',
        resumeHandle,
        raw,
        cause,
      });

      expect(error.name).toBe('PlatformError');
      expect(error.message).toBe('Rate limit exceeded');
      expect(error.code).toBe(ErrorCode.RATE_LIMIT_ERROR);
      expect(error.retryable).toBe(true);
      expect(error.retryAfterMs).toBe(5000);
      expect(error.httpStatus).toBe(429);
      expect(error.platformCode).toBe('429');
      expect(error.resumeHandle).toEqual(resumeHandle);
      expect(error.raw).toBe(raw);
      expect(error.cause).toBe(cause);
    });

    it('defaults retryable to false and other optional fields to undefined', () => {
      const error = new PlatformError('Generic error', ErrorCode.INTERNAL_ERROR);

      expect(error.retryable).toBe(false);
      expect(error.retryAfterMs).toBeUndefined();
      expect(error.httpStatus).toBeUndefined();
      expect(error.platformCode).toBeUndefined();
      expect(error.resumeHandle).toBeUndefined();
      expect(error.raw).toBeUndefined();
    });
  });
});
