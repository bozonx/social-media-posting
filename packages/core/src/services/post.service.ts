import { BasePostService } from './base-post.service.js';
import { ErrorCode } from '../errors/error-code.js';
import { AbortedError, PostingError, ValidationError } from '../errors/posting-error.js';
import { PlatformError } from '../errors/platform-error.js';
import { assertValidPostRequest } from '../validation/validate-post-request.js';
import { detectPostType } from '../validation/detect-post-type.js';
import { validateAgainstCapabilities } from '../validation/capability-validator.js';
import type { PostRequest } from '../types/post-request.js';
import type {
  ErrorPayload,
  ErrorResponse,
  PostResponse,
  PostResult,
  StatusResult,
  DeleteResult,
  PostRef,
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
 * Options for a deletion call.
 */
export interface DeleteCallOptions {
  /** Aborts the operation. */
  signal?: AbortSignal;
  /** Resume from an earlier partial deletion. */
  resume?: ResumeHandle;
  /** Include the platform's diagnostic payload in the result. Defaults to false. */
  includeRaw?: boolean;
}

/**
 * Publishes and manages posts across social networks.
 */
export class PostService extends BasePostService {
  /**
   * Publish a post.
   *
   * @param request - Post request with platform, content and media.
   * @param options - Abort signal, includeRaw and optional resume handle.
   * @returns Success payload, or an error payload describing what went wrong.
   */
  async publish(request: PostRequest, options: PublishCallOptions = {}): Promise<PostResult> {
    const requestId = crypto.randomUUID();

    try {
      assertValidPostRequest(request);

      const { platform, accountConfig } = await this.validateRequest(request);
      const effectiveCapabilities =
        accountConfig.maxBodyLength !== undefined
          ? {
              ...platform.capabilities,
              maxBodyLength:
                platform.capabilities.maxBodyLength !== undefined
                  ? Math.min(platform.capabilities.maxBodyLength, accountConfig.maxBodyLength)
                  : accountConfig.maxBodyLength,
            }
          : platform.capabilities;

      const validateExtra = platform.validateExtra?.bind(platform);
      const validation = validateAgainstCapabilities(request, effectiveCapabilities, {
        detectType: platform.detectType?.bind(platform) ?? detectPostType,
        validateExtra: validateExtra
          ? (candidate, detectedType) => validateExtra(candidate, accountConfig, detectedType)
          : undefined,
      });
      if (validation.issues.length > 0) {
        throw new ValidationError(validation.issues);
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
        signal => platform.publish(request, accountConfig, { signal, resume: options.resume }),
        options.signal,
      );

      const response: PostResponse = {
        success: true,
        data: {
          status: result.status,
          postId: result.postId,
          url: result.url,
          parts: result.parts,
          ref: result.ref ?? {
            postId: result.postId,
            target: request.target,
            parts: result.parts,
          },
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
   * Delete a post by reference.
   *
   * @param request - Platform, account, auth and optional target.
   * @param ref - PostRef identifying the post and its parts to delete.
   * @param options - Abort signal, resume handle and includeRaw.
   */
  async delete(
    request: Pick<PostRequest, 'platform' | 'account' | 'auth' | 'target'>,
    ref: PostRef,
    options: DeleteCallOptions = {},
  ): Promise<DeleteResult> {
    const requestId = crypto.randomUUID();
    try {
      const { platform, accountConfig } = await this.validateRequest({
        platform: request.platform,
        account: request.account,
        auth: request.auth,
      });

      const deleteFn = platform.delete?.bind(platform);
      if (!deleteFn) {
        throw new ValidationError(`Platform "${platform.name}" does not support deletion`);
      }

      if (options.resume && options.resume.platform !== platform.name) {
        throw new ValidationError(
          `Resume handle belongs to platform "${options.resume.platform}", not "${platform.name}"`,
        );
      }
      if (options.resume?.expiresAt && Date.parse(options.resume.expiresAt) <= Date.now()) {
        throw new ValidationError('Resume handle has expired');
      }

      const effectiveRef: PostRef = {
        ...ref,
        target: ref.target ?? request.target ?? accountConfig.target,
      };

      this.logger.log(
        `Deleting post on ${platform.name} (postId: ${effectiveRef.postId ?? 'unknown'}, requestId: ${requestId})`,
        LOG_CONTEXT,
      );

      const result = await this.withRequestTimeout(
        signal => deleteFn(effectiveRef, accountConfig, { signal, resume: options.resume }),
        options.signal,
      );

      return {
        success: true,
        data: {
          status: result.status,
          parts: result.parts,
          handle: result.handle,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `Failed to delete on ${request.platform}: ${message} (requestId: ${requestId})`,
        stack,
        LOG_CONTEXT,
      );
      return { success: false, error: errorPayload(error, requestId, options.includeRaw ?? false) };
    }
  }

  /**
   * Check on a post that `publish()` left in `processing`.
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
      const { platform, accountConfig } = await this.validateRequest(request);
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
        success: true,
        data: {
          status: result.status,
          postId: result.postId,
          url: result.url,
          ref: result.ref,
          checkAfterMs: result.checkAfterMs,
          reason: result.error ? errorPayload(result.error, crypto.randomUUID(), false) : undefined,
          raw: result.raw,
        },
      };
    } catch (error) {
      return { success: false, error: errorPayload(error, crypto.randomUUID(), false) };
    }
  }

  private toErrorResponse(
    error: unknown,
    request: PostRequest,
    requestId: string,
    includeRaw: boolean,
  ): ErrorResponse {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const stack = error instanceof Error ? error.stack : undefined;

    this.logger.error(
      `Failed to publish to ${request.platform}: ${message} (requestId: ${requestId})`,
      stack,
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

/**
 * Flatten an error into the payload shape hosts read.
 */
function errorPayload(error: unknown, requestId: string, includeRaw = true): ErrorPayload {
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
      details:
        error instanceof ValidationError
          ? { issues: error.issues, errors: error.errors }
          : undefined,
      raw: includeRaw ? error.cause : undefined,
      requestId,
    };
  }

  const err = (error ?? {}) as { message?: string; stack?: string };
  return {
    code: ErrorCode.INTERNAL_ERROR,
    message: err.message ?? 'Unknown error',
    retryable: false,
    raw: includeRaw ? error : undefined,
    requestId,
  };
}
