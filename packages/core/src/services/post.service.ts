import { BasePostService } from './base-post.service.js';
import { PostType } from '../types/post-type.js';
import { ErrorCode } from '../errors/error-code.js';
import { AbortedError, PostingError, ValidationError } from '../errors/posting-error.js';
import { assertValidPostRequest } from '../validation/validate-post-request.js';
import type { PostRequest } from '../types/post-request.js';
import type { ErrorResponse, PostResponse, PostResult } from '../types/post-response.js';

/** Minimum jitter factor for retry delay randomization (80%). */
const MIN_JITTER_FACTOR = 0.8;
/** Maximum jitter factor for retry delay randomization (120%). */
const MAX_JITTER_FACTOR = 1.2;

const LOG_CONTEXT = 'PostService';

/**
 * Publishes a post through the platform that owns the requested network.
 */
export class PostService extends BasePostService {
  /**
   * Publish a post.
   *
   * Never throws for an expected failure: the outcome is always a result object
   * so a host can branch on `success` without a try/catch around every call.
   *
   * @param request - Post request with platform, content and media.
   * @param abortSignal - Aborts the operation, including the in-flight platform call.
   * @returns Success payload, or an error payload describing what went wrong.
   */
  async publish(request: PostRequest, abortSignal?: AbortSignal): Promise<PostResult> {
    const requestId = crypto.randomUUID();

    try {
      assertValidPostRequest(request);

      const { platform, accountConfig } = this.validateRequest(request);

      const postType = request.type || PostType.AUTO;
      if (!platform.supportedTypes.includes(postType)) {
        throw new ValidationError(
          `Post type "${postType}" is not supported by ${request.platform}`,
        );
      }

      this.logger.log(
        `Publishing to ${request.platform} via ${
          accountConfig.source === 'account' ? request.account : 'inline auth'
        }, type: ${postType} (requestId: ${requestId})`,
        LOG_CONTEXT,
      );

      if (abortSignal?.aborted) {
        throw new AbortedError('Request aborted by client');
      }

      const result = await this.executeWithRequestTimeout(
        combinedSignal =>
          this.retryWithJitter(
            () => platform.publish(request, accountConfig, combinedSignal),
            this.config.retryAttempts,
            this.config.retryDelayMs,
            combinedSignal,
          ),
        this.config.requestTimeoutSecs * 1000,
        abortSignal,
      );

      const response: PostResponse = {
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

      return response;
    } catch (error) {
      return this.toErrorResponse(error, request, requestId);
    }
  }

  private toErrorResponse(error: unknown, request: PostRequest, requestId: string): ErrorResponse {
    const err = error as { message?: string } & Record<string, unknown>;

    this.logger.error(
      `Failed to publish to ${request.platform}: ${err?.message ?? 'Unknown error'} (requestId: ${requestId})`,
      err?.stack as string | undefined,
      LOG_CONTEXT,
    );

    return {
      success: false,
      error: {
        code: getErrorCode(error),
        message: err?.message ?? 'Unknown error',
        details: collectErrorDetails(err),
        raw: err,
        requestId,
      },
    };
  }

  private async executeWithRequestTimeout<T>(
    fn: (signal: AbortSignal) => Promise<T>,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<T> {
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const abortController = new AbortController();

    if (signal?.aborted) {
      throw new AbortedError('Request aborted by client');
    }

    const onAbort = () => {
      abortController.abort(signal?.reason ?? new AbortedError('Request aborted by client'));
    };

    signal?.addEventListener('abort', onAbort, { once: true });

    try {
      return await Promise.race<T>([
        fn(abortController.signal),
        new Promise<T>((_, reject) => {
          timeoutHandle = setTimeout(() => {
            const error = new AbortedError(
              `Request timed out after ${timeoutMs}ms`,
              ErrorCode.TIMEOUT_ERROR,
            );
            abortController.abort(error);
            reject(error);
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      signal?.removeEventListener('abort', onAbort);
    }
  }

  /**
   * Retry with a randomized, linearly growing delay.
   * @param fn - Operation to run.
   * @param maxAttempts - Total number of attempts, including the first.
   * @param baseDelayMs - Delay before the second attempt; grows per attempt.
   * @param signal - Aborts both the operation and the wait between attempts.
   * @throws The last error when every attempt failed.
   */
  private async retryWithJitter<T>(
    fn: () => Promise<T>,
    maxAttempts: number,
    baseDelayMs: number,
    signal?: AbortSignal,
  ): Promise<T> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (signal?.aborted) {
        throw new AbortedError('Operation aborted');
      }

      try {
        return await fn();
      } catch (error) {
        lastError = error;

        if (error instanceof ValidationError) {
          throw error;
        }
        if (attempt === maxAttempts || !shouldRetry(error)) {
          throw error;
        }

        const jitter = MIN_JITTER_FACTOR + Math.random() * (MAX_JITTER_FACTOR - MIN_JITTER_FACTOR);
        const delay = Math.floor(baseDelayMs * jitter * attempt);

        this.logger.warn(
          `Attempt ${attempt}/${maxAttempts} failed, retrying in ${delay}ms: ${
            (error as Error)?.message ?? 'Unknown error'
          }`,
          LOG_CONTEXT,
        );

        await sleep(delay, signal);
      }
    }

    throw lastError;
  }
}

/**
 * Sleep with abort support.
 * @param ms - Milliseconds to wait.
 * @param signal - Rejects the wait as soon as it aborts.
 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AbortedError('Request aborted by client'));
      return;
    }

    const onAbort = () => {
      clearTimeout(timeoutId);
      reject(new AbortedError('Request aborted by client'));
    };

    const timeoutId = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function collectErrorDetails(error: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!error) {
    return {};
  }
  const cause = error.cause as { code?: unknown; message?: unknown } | undefined;
  const details: Record<string, unknown> = {};
  const code = error.code ?? cause?.code;
  if (code !== undefined) {
    details.code = code;
  }
  if (cause?.message !== undefined) {
    details.originalMessage = cause.message;
  }
  return details;
}

/**
 * Classify an error into a machine-readable code.
 *
 * Platform-specific classification belongs to the platform package; what is
 * left here covers failures raised by the core itself.
 */
function getErrorCode(error: unknown): ErrorCode {
  if (!error) {
    return ErrorCode.INTERNAL_ERROR;
  }
  if (error instanceof PostingError) {
    return error.code;
  }

  const err = error as { message?: string; code?: string; cause?: { code?: string } };
  const message = err.message ?? '';
  const code = err.code ?? err.cause?.code;

  if (
    code === 'ETIMEDOUT' ||
    code === 'TIMEOUT' ||
    code === 'UND_ERR_HEADERS_TIMEOUT' ||
    message.includes('timed out')
  ) {
    return ErrorCode.TIMEOUT_ERROR;
  }

  if (
    code === 'ENOTFOUND' ||
    code === 'ECONNRESET' ||
    code === 'ECONNREFUSED' ||
    code === 'EAI_AGAIN' ||
    code === 'EADDRNOTAVAIL' ||
    message.includes('fetch failed')
  ) {
    return ErrorCode.NETWORK_ERROR;
  }

  return ErrorCode.PLATFORM_ERROR;
}

function shouldRetry(error: unknown): boolean {
  const code = getErrorCode(error);
  return (
    code === ErrorCode.NETWORK_ERROR ||
    code === ErrorCode.TIMEOUT_ERROR ||
    code === ErrorCode.RATE_LIMIT_ERROR
  );
}
