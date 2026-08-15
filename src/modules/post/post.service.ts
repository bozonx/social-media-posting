import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PostRequestDto, PostResponseDto, ErrorResponseDto } from './dto/index.js';
import { PostType, ErrorCode } from '../../common/enums/index.js';
import { AppConfigService } from '../app-config/app-config.service.js';
import { IdempotencyService } from './idempotency.service.js';
import { PlatformRegistry } from '../platforms/base/platform-registry.service.js';
import { AuthValidatorRegistry } from '../platforms/base/auth-validator-registry.service.js';
import { BasePostService, ResolvedAccountConfig } from './base-post.service.js';
import { ShutdownService } from '../../common/services/shutdown.service.js';

@Injectable()
export class PostService extends BasePostService {
  protected readonly logger = new Logger(PostService.name);
  /** Minimum jitter factor for retry delay randomization (80%) */
  private static readonly MIN_JITTER_FACTOR = 0.8;
  /** Maximum jitter factor for retry delay randomization (120%) */
  private static readonly MAX_JITTER_FACTOR = 1.2;
  private static readonly DEFAULT_REQUEST_TIMEOUT_SECS = 60;
  private static readonly MAX_REQUEST_TIMEOUT_SECS = 600;

  constructor(
    appConfig: AppConfigService,
    platformRegistry: PlatformRegistry,
    authValidatorRegistry: AuthValidatorRegistry,
    private readonly idempotencyService: IdempotencyService,
    private readonly shutdownService: ShutdownService,
  ) {
    super(appConfig, platformRegistry, authValidatorRegistry);
  }

  /**
   * Publish a post to a social media platform
   * Handles idempotency, platform selection, retry logic, and error handling
   * @param request - Post request with platform, content, and media
   * @param abortSignal - Optional signal to abort the operation
   * @returns Success response with post details or error response
   */
  async publish(
    request: PostRequestDto,
    abortSignal?: AbortSignal,
  ): Promise<PostResponseDto | ErrorResponseDto> {
    const requestId = randomUUID();
    const idempotencyKey = this.idempotencyService.buildKey(request);
    let idempotencyLocked = false;

    if (idempotencyKey) {
      const lock = this.idempotencyService.acquireLock(idempotencyKey);

      if (!lock.acquired) {
        if (lock.status === 'processing') {
          return {
            success: false,
            error: {
              code: ErrorCode.VALIDATION_ERROR,
              message: 'Request with the same idempotencyKey is already being processed',
              requestId,
            },
          };
        }

        if (lock.status === 'completed' && lock.response) {
          return lock.response;
        }
      }

      idempotencyLocked = lock.acquired;
    }

    try {
      const { platform, accountConfig } = this.validateRequest(request);

      const requestTimeoutMs = this.getRequestTimeoutMs(this.appConfig.requestTimeoutSecs);

      // Check if explicit type is supported
      const postType = request.type || PostType.AUTO;
      if (!platform.supportedTypes.includes(postType)) {
        throw new BadRequestException(
          `Post type "${postType}" is not supported by ${request.platform}`,
        );
      }

      this.logger.log({
        message: `Publishing to ${request.platform} via ${accountConfig.source === 'account' ? request.account : 'inline auth'}, type: ${postType}`,
        metadata: {
          requestId,
          platform: request.platform,
          account: request.account,
          type: postType,
        },
      });

      if (abortSignal?.aborted) {
        throw new Error('Request aborted by client');
      }

      const result: any = await this.executeWithRequestTimeout(
        combinedSignal =>
          this.retryWithJitter(
            () => platform.publish(request, accountConfig, combinedSignal),
            this.appConfig.retryAttempts,
            this.appConfig.retryDelayMs,
            combinedSignal,
          ),
        requestTimeoutMs,
        abortSignal,
      );

      const response: PostResponseDto = {
        success: true,
        data: {
          postId: result.postId,
          url: result.url,
          platform: request.platform,
          type: postType,
          publishedAt: new Date().toISOString(),
          raw: result.raw,
          requestId,
        },
      };

      if (idempotencyKey) {
        await this.idempotencyService.setCompleted(idempotencyKey, response);
      }

      return response;
    } catch (error: any) {
      // Log full error with stack trace for debugging
      this.logger.error({
        message: `Failed to publish to ${request.platform}: ${error?.message ?? 'Unknown error'}`,
        metadata: {
          requestId,
          platform: request.platform,
          account: request.account,
          type: request.type,
        },
        err: error, // Full error object with stack trace
      });

      try {
        const errorResponse: ErrorResponseDto = {
          success: false,
          error: {
            code: this.getErrorCode(error),
            message: error.message,
            details: {
              code: error.code || error.error?.code || error.cause?.code,
              originalMessage: error.error?.message || error.cause?.message,
              // grammY specific info
              ...(error.payload && { payload: error.payload }),
              ...(error.description && { description: error.description }),
              ...error.response?.data,
            },
            raw: error.response || error,
            requestId,
          },
        };

        // Always update idempotency record if we locked it
        if (idempotencyKey && idempotencyLocked) {
          await this.idempotencyService.setCompleted(idempotencyKey, errorResponse);
        }

        return errorResponse;
      } catch (innerError: any) {
        // Emergency catch if something fails during error processing
        this.logger.error('Critical failure in error handler', innerError);
        return {
          success: false,
          error: {
            code: ErrorCode.INTERNAL_ERROR,
            message: error?.message || 'Unknown internal error',
            requestId,
          },
        } as ErrorResponseDto;
      }
    }
  }

  /**
   * Map error to appropriate error code
   * Categorizes errors for better error handling and monitoring
   * @param error - Error object
   * @returns Error code string
   */
  private getErrorCode(error: any): string {
    if (!error) {
      return ErrorCode.INTERNAL_ERROR;
    }
    if (error instanceof BadRequestException) {
      return ErrorCode.VALIDATION_ERROR;
    }

    const message = error.message || '';
    // Look for code in standard locations and grammY's HttpError (error.error) or generic cause
    const code = error.code || error.error?.code || error.cause?.code;

    if (
      code === 'ETIMEDOUT' ||
      code === 'TIMEOUT' ||
      code === 'UND_ERR_HEADERS_TIMEOUT' ||
      message.includes('timed out') ||
      message.includes('TIMEOUT')
    ) {
      return ErrorCode.TIMEOUT_ERROR;
    }

    const isNetworkError =
      code === 'ENOTFOUND' ||
      code === 'ECONNRESET' ||
      code === 'ECONNREFUSED' ||
      code === 'EAI_AGAIN' ||
      code === 'EADDRNOTAVAIL' ||
      message.includes('Network request') ||
      message.includes('fetch failed') ||
      message.includes('undici');

    if (isNetworkError) {
      return ErrorCode.NETWORK_ERROR;
    }

    // GrammY/Platform specific errors
    const status = error.response?.status || error.payload?.error_code;
    if (status === 429) {
      return ErrorCode.RATE_LIMIT_ERROR;
    }
    if (status === 401 || status === 403) {
      return ErrorCode.AUTH_ERROR;
    }
    if (status >= 500) {
      return ErrorCode.PLATFORM_ERROR;
    }

    return ErrorCode.PLATFORM_ERROR;
  }

  private getRequestTimeoutMs(requestTimeoutSecs: number | undefined): number {
    const defaultSecs = PostService.DEFAULT_REQUEST_TIMEOUT_SECS;
    const maxSecs = PostService.MAX_REQUEST_TIMEOUT_SECS;

    const normalizedSecs =
      typeof requestTimeoutSecs === 'number' && requestTimeoutSecs > 0
        ? requestTimeoutSecs
        : defaultSecs;

    if (normalizedSecs > maxSecs) {
      throw new Error(`requestTimeoutSecs must not exceed ${maxSecs} seconds`);
    }

    return normalizedSecs * 1000;
  }

  private async executeWithRequestTimeout<T>(
    fn: (signal: AbortSignal) => Promise<T>,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<T> {
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const abortController = new AbortController();

    if (signal?.aborted) {
      throw new Error('Request aborted by client');
    }

    // Link external signal to our internal controller
    const onAbort = () => {
      abortController.abort(signal?.reason || new Error('Request aborted by client'));
    };

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }

    try {
      return await Promise.race<T>([
        fn(abortController.signal),
        new Promise<T>((_, reject) => {
          timeoutHandle = setTimeout(() => {
            const error: any = new Error(`Request timed out after ${timeoutMs}ms`);
            error.code = 'ETIMEDOUT';
            abortController.abort(error);
            reject(error);
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
    }
  }

  /**
   * Retry function with exponential backoff and jitter
   * Implements retry logic with randomized delays to avoid thundering herd
   * @param fn - Async function to retry
   * @param maxAttempts - Maximum number of attempts
   * @param baseDelayMs - Base delay in milliseconds
   * @param abortSignal - Optional signal to abort retry loop
   * @returns Result of successful function execution
   * @throws Last error if all attempts fail
   */
  private async retryWithJitter<T>(
    fn: () => Promise<T>,
    maxAttempts: number,
    baseDelayMs: number,
    signal?: AbortSignal,
  ): Promise<T> {
    let lastError: any;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      // Check if shutdown is in progress before attempting
      if (this.shutdownService.shuttingDown) {
        this.logger.warn('Aborting retry loop: shutdown in progress');
        throw new Error('Operation aborted due to shutdown');
      }

      // Check if operation was aborted
      if (signal?.aborted) {
        this.logger.warn('Aborting retry loop: abort signal received');
        throw new Error('Operation aborted');
      }

      try {
        return await fn();
      } catch (error: any) {
        lastError = error;

        if (error instanceof BadRequestException) {
          throw error;
        }

        if (attempt === maxAttempts) {
          break;
        }

        const shouldRetry = this.shouldRetry(error);
        if (!shouldRetry) {
          throw error;
        }

        const jitterRange = PostService.MAX_JITTER_FACTOR - PostService.MIN_JITTER_FACTOR;
        const jitter = PostService.MIN_JITTER_FACTOR + Math.random() * jitterRange; // random(0.8, 1.2)
        const delay = Math.floor(baseDelayMs * jitter * attempt);

        this.logger.warn({
          message: `Attempt ${attempt}/${maxAttempts} failed, retrying in ${delay}ms: ${error?.message ?? 'Unknown error'}`,
          metadata: {
            attempt,
            maxAttempts,
            delay,
          },
          err: error,
        });

        if (signal?.aborted) {
          throw new Error('Request aborted by client');
        }

        await this.sleep(delay, signal);
      }
    }

    throw lastError;
  }

  /**
   * Determine if an error should trigger a retry
   * Retries on network errors, server errors, and rate limits
   * @param error - Error object
   * @returns True if should retry, false otherwise
   */
  private shouldRetry(error: any): boolean {
    const message = error?.message || '';
    const isNetworkError =
      error.code === 'ENOTFOUND' ||
      error.code === 'ETIMEDOUT' ||
      error.code === 'ECONNRESET' ||
      error.code === 'ECONNREFUSED' ||
      message.includes('Network request') ||
      message.includes('fetch failed');

    if (isNetworkError) {
      return true;
    }
    if (error.response?.status >= 500) {
      return true;
    }
    if (error.response?.status === 429) {
      return true;
    }
    return false;
  }

  /**
   * Sleep for specified milliseconds with abort support
   * @param ms - Milliseconds to sleep
   * @param abortSignal - Optional signal to abort sleep
   * @returns Promise that resolves after delay or rejects if aborted
   */
  private sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        return reject(new Error('Request aborted by client'));
      }

      const onAbort = () => {
        clearTimeout(timeoutId);
        reject(new Error('Request aborted by client'));
      };

      const timeoutId = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, ms);

      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }
}
