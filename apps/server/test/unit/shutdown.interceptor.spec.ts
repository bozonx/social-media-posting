import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import {
  ServiceUnavailableException,
  type ExecutionContext,
  type CallHandler,
} from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { ShutdownInterceptor } from '../../src/common/interceptors/shutdown.interceptor.js';
import { type ShutdownService } from '../../src/common/services/shutdown.service.js';

describe('ShutdownInterceptor', () => {
  let interceptor: ShutdownInterceptor;
  let mockShutdownService: {
    shuttingDown: boolean;
    trackRequest: Mock;
    untrackRequest: Mock;
  };
  let mockExecutionContext: ExecutionContext;
  let mockCallHandler: CallHandler;

  beforeEach(() => {
    mockShutdownService = {
      shuttingDown: false,
      trackRequest: vi.fn(),
      untrackRequest: vi.fn(),
    };

    interceptor = new ShutdownInterceptor(mockShutdownService as unknown as ShutdownService);

    mockExecutionContext = {} as ExecutionContext;
  });

  describe('intercept', () => {
    it('should throw ServiceUnavailableException when shutting down', () => {
      mockShutdownService.shuttingDown = true;
      mockCallHandler = { handle: vi.fn() };

      expect(() => interceptor.intercept(mockExecutionContext, mockCallHandler)).toThrow(
        ServiceUnavailableException,
      );
      expect(() => interceptor.intercept(mockExecutionContext, mockCallHandler)).toThrow(
        'Server is shutting down',
      );
      expect(mockShutdownService.trackRequest).not.toHaveBeenCalled();
    });

    it('should track request and untrack on success', async () => {
      mockCallHandler = {
        handle: vi.fn().mockReturnValue(of({ result: 'success' })),
      };

      const value = await new Promise(resolve => {
        interceptor.intercept(mockExecutionContext, mockCallHandler).subscribe({ next: resolve });
      });

      expect(value).toEqual({ result: 'success' });
      expect(mockShutdownService.trackRequest).toHaveBeenCalledTimes(1);
      expect(mockShutdownService.untrackRequest).toHaveBeenCalledTimes(1);
    });

    it('should track request and untrack on error', async () => {
      const testError = new Error('Test error');
      mockCallHandler = {
        handle: vi.fn().mockReturnValue(throwError(() => testError)),
      };

      const err = await new Promise(resolve => {
        interceptor.intercept(mockExecutionContext, mockCallHandler).subscribe({ error: resolve });
      });

      expect(err).toBe(testError);
      expect(mockShutdownService.trackRequest).toHaveBeenCalledTimes(1);
      expect(mockShutdownService.untrackRequest).toHaveBeenCalledTimes(1);
    });

    it('should allow requests when not shutting down', () => {
      mockShutdownService.shuttingDown = false;
      mockCallHandler = {
        handle: vi.fn().mockReturnValue(of('result')),
      };

      expect(() => interceptor.intercept(mockExecutionContext, mockCallHandler)).not.toThrow();
      expect(mockShutdownService.trackRequest).toHaveBeenCalledTimes(1);
    });
  });
});
