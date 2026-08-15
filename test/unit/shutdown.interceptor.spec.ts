import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  ServiceUnavailableException,
  type ExecutionContext,
  type CallHandler,
} from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { ShutdownInterceptor } from '@/common/interceptors/shutdown.interceptor.js';
import { type ShutdownService } from '@/common/services/shutdown.service.js';

describe('ShutdownInterceptor', () => {
  let interceptor: ShutdownInterceptor;
  let mockShutdownService: {
    shuttingDown: boolean;
    trackRequest: jest.Mock;
    untrackRequest: jest.Mock;
  };
  let mockExecutionContext: ExecutionContext;
  let mockCallHandler: CallHandler;

  beforeEach(() => {
    mockShutdownService = {
      shuttingDown: false,
      trackRequest: jest.fn(),
      untrackRequest: jest.fn(),
    };

    interceptor = new ShutdownInterceptor(mockShutdownService as unknown as ShutdownService);

    mockExecutionContext = {} as ExecutionContext;
  });

  describe('intercept', () => {
    it('should throw ServiceUnavailableException when shutting down', () => {
      mockShutdownService.shuttingDown = true;
      mockCallHandler = { handle: jest.fn() };

      expect(() => interceptor.intercept(mockExecutionContext, mockCallHandler)).toThrow(
        ServiceUnavailableException,
      );
      expect(() => interceptor.intercept(mockExecutionContext, mockCallHandler)).toThrow(
        'Server is shutting down',
      );
      expect(mockShutdownService.trackRequest).not.toHaveBeenCalled();
    });

    it('should track request and untrack on success', done => {
      mockCallHandler = {
        handle: jest.fn().mockReturnValue(of({ result: 'success' })),
      };

      interceptor.intercept(mockExecutionContext, mockCallHandler).subscribe({
        next: value => {
          expect(value).toEqual({ result: 'success' });
        },
        complete: () => {
          expect(mockShutdownService.trackRequest).toHaveBeenCalledTimes(1);
          expect(mockShutdownService.untrackRequest).toHaveBeenCalledTimes(1);
          done();
        },
      });
    });

    it('should track request and untrack on error', done => {
      const testError = new Error('Test error');
      mockCallHandler = {
        handle: jest.fn().mockReturnValue(throwError(() => testError)),
      };

      interceptor.intercept(mockExecutionContext, mockCallHandler).subscribe({
        error: err => {
          expect(err).toBe(testError);
          expect(mockShutdownService.trackRequest).toHaveBeenCalledTimes(1);
          expect(mockShutdownService.untrackRequest).toHaveBeenCalledTimes(1);
          done();
        },
      });
    });

    it('should allow requests when not shutting down', () => {
      mockShutdownService.shuttingDown = false;
      mockCallHandler = {
        handle: jest.fn().mockReturnValue(of('result')),
      };

      expect(() => interceptor.intercept(mockExecutionContext, mockCallHandler)).not.toThrow();
      expect(mockShutdownService.trackRequest).toHaveBeenCalledTimes(1);
    });
  });
});
