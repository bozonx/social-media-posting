import { BasePostService } from './base-post.service.js';
import { ErrorCode } from '../errors/error-code.js';
import { AbortedError, PostingError, ValidationError } from '../errors/posting-error.js';
import { PlatformError } from '../errors/platform-error.js';
import { assertValidPostRequest } from '../validation/validate-post-request.js';
import { detectPostType } from '../validation/detect-post-type.js';
import { validateAgainstCapabilities } from '../validation/capability-validator.js';
import type { PostRequest } from '../types/post-request.js';
import type {
  ErrorResponse,
  PostResponse,
  PostResult,
  StatusResult,
} from '../types/post-response.js';
import type { ResumeHandle } from '../types/resume-handle.js';

const LOG_CONTEXT = 'PostService';

/**
 * Options for a single `publish()` call.
 */
export interface PublishCallOptions {
  /** Aborts the operation, including the in-flight platform call. */
  signal?: AbortSignal;
  /**
   * Progress from a previous failed attempt, taken from
   * `error.resumeHandle`. The platform continues from that step instead of
   * repeating the whole sequence.
   */
  resume?: ResumeHandle;
  /** Include the platform's diagnostic payload in the result. Defaults to false. */
  includeRaw?: boolean;
}

/**
 * Publishes a post through the platform that owns the requested network.
 *
 * Exactly one attempt is made. Retrying — with whatever backoff, budget and
 * dead-lettering the host runs — is the host's job, and every error carries the
 * `retryable`, `retryAfterMs` and `resumeHandle` it needs to do that.
 */
export class PostService extends BasePostService {
  /**
   * Publish a post.
   *
   * Never throws for an expected failure: the outcome is always a result object
   * so a host can branch on `success` without a try/catch around every call.
   *
   * @param request - Post request with platform, content and media.
   * @param options - Abort signal and optional resume handle.
   * @returns Success payload, or an error payload describing what went wrong.
   */
  async publish(request: PostRequest, options: PublishCallOptions = {}): Promise<PostResult> {
    const requestId = crypto.randomUUID();

    try {
      assertValidPostRequest(request);

      const { platform, accountConfig } = await this.validateRequest(request);
      const effectiveRequest = withAccountBodyLimit(request, accountConfig.maxBody);
      const validateExtra = platform.validateExtra?.bind(platform);
      const validation = validateAgainstCapabilities(effectiveRequest, platform.capabilities, {
        detectType: platform.detectType?.bind(platform) ?? detectPostType,
        validateExtra: validateExtra
          ? (candidate, detectedType) => validateExtra(candidate, accountConfig, detectedType)
          : undefined,
      });
      if (validation.errors.length > 0) {
        throw new ValidationError(validation.errors);
      }
      const postType = validation.detectedType;

      if (options.resume && options.resume.platform !== platform.name) {
        throw new ValidationError(
          `Resume handle belongs to platform "${options.resume.platform}", not "${platform.name}"`,
        );
      }
      if (options.resume?.expiresAt && Date.parse(options.resume.expiresAt) <= Date.now()) {
        throw new ValidationError('Resume handle has expired');
      }

      this.logger.log(
        `Publishing to ${request.platform} via ${
          accountConfig.source === 'account' ? request.account : 'inline auth'
        }, type: ${postType}${options.resume ? `, resuming from "${options.resume.step}"` : ''} (requestId: ${requestId})`,
        LOG_CONTEXT,
      );

      const result = await this.withRequestTimeout(
        signal =>
          platform.publish(effectiveRequest, accountConfig, { signal, resume: options.resume }),
        options.signal,
      );

      const response: PostResponse = {
        success: true,
        data: {
          status: result.status,
          postId: result.postId,
          url: result.url,
          handle: result.handle,
          checkAfterMs: result.checkAfterMs,
          platform: request.platform,
          type: postType,
          publishedAt: new Date().toISOString(),
          raw: options.includeRaw ? result.raw : undefined,
          requestId,
        },
      };

      return response;
    } catch (error) {
      return this.toErrorResponse(error, request, requestId, options.includeRaw ?? false);
    }
  }

  /**
   * Check on a post that `publish()` left in `processing`.
   *
   * The host decides when to call this; nothing here polls on its own.
   *
   * @param request - Enough of a request to resolve the platform and credentials.
   * @param handle - The handle `publish()` returned.
   * @param signal - Aborts the operation.
   */
  async checkStatus(
    request: Pick<PostRequest, 'platform' | 'account' | 'auth'>,
    handle: ResumeHandle,
    signal?: AbortSignal,
  ): Promise<StatusResult> {
    try {
      const { platform, accountConfig } = await this.validateRequest(request as PostRequest);
      const checkStatus = platform.checkStatus?.bind(platform);
      if (!checkStatus) {
        throw new ValidationError(
          `Platform "${platform.name}" publishes synchronously and has no status to check`,
        );
      }
      if (handle.platform !== platform.name) {
        throw new ValidationError(
          `Handle belongs to platform "${handle.platform}", not "${platform.name}"`,
        );
      }
      if (handle.expiresAt && Date.parse(handle.expiresAt) <= Date.now()) {
        throw new ValidationError('Resume handle has expired');
      }

      const result = await this.withRequestTimeout(
        innerSignal => checkStatus(handle, accountConfig, innerSignal),
        signal,
      );

      return {
        status: result.status,
        postId: result.postId,
        url: result.url,
        checkAfterMs: result.checkAfterMs,
        error: result.error ? errorPayload(result.error, crypto.randomUUID(), false) : undefined,
        raw: result.raw,
      };
    } catch (error) {
      return { status: 'failed', error: errorPayload(error, crypto.randomUUID(), false) };
    }
  }

  private toErrorResponse(
    error: unknown,
    request: PostRequest,
    requestId: string,
    includeRaw: boolean,
  ): ErrorResponse {
    const message = (error as Error)?.message ?? 'Unknown error';

    this.logger.error(
      `Failed to publish to ${request.platform}: ${message} (requestId: ${requestId})`,
      (error as Error)?.stack,
      LOG_CONTEXT,
    );

    return { success: false, error: errorPayload(error, requestId, includeRaw) };
  }

  /**
   * Run an operation under the configured request timeout, linking the caller's
   * signal to the one the platform receives.
   */
  private async withRequestTimeout<T>(
    fn: (signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const timeoutMs = this.config.requestTimeoutSecs * 1000;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const abortController = new AbortController();

    if (signal?.aborted) {
      throw new AbortedError('Request aborted by client', ErrorCode.NETWORK_ERROR);
    }

    const onAbort = () => {
      abortController.abort(
        signal?.reason ?? new AbortedError('Request aborted by client', ErrorCode.NETWORK_ERROR),
      );
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
}

function withAccountBodyLimit(
  request: PostRequest,
  accountMaxBody: number | undefined,
): PostRequest {
  if (accountMaxBody === undefined) return request;
  return { ...request, maxBody: Math.min(request.maxBody ?? accountMaxBody, accountMaxBody) };
}

/**
 * Flatten an error into the payload shape hosts read.
 *
 * Platforms classify their own failures, so this only has to unpack a
 * {@link PlatformError} or fall back for a failure raised by the core itself.
 */
function errorPayload(
  error: unknown,
  requestId: string,
  includeRaw = true,
): ErrorResponse['error'] {
  if (error instanceof PlatformError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      retryAfterMs: error.retryAfterMs,
      httpStatus: error.httpStatus,
      platformCode: error.platformCode,
      resumeHandle: error.resumeHandle,
      raw: includeRaw ? (error.raw ?? error.cause) : undefined,
      requestId,
    };
  }

  if (error instanceof PostingError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      details: error instanceof ValidationError ? { errors: error.errors } : undefined,
      raw: includeRaw ? error.cause : undefined,
      requestId,
    };
  }

  const err = (error ?? {}) as { message?: string; stack?: string };
  return {
    code: ErrorCode.INTERNAL_ERROR,
    message: err.message ?? 'Unknown error',
    // An error the platform did not classify is not something to retry blindly.
    retryable: false,
    raw: includeRaw ? error : undefined,
    requestId,
  };
}
