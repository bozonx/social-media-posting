import { BasePostService } from './base-post.service.js';
import { ErrorCode } from '../errors/error-code.js';
import { AbortedError, PostingError, ValidationError } from '../errors/posting-error.js';
import { PlatformError } from '../errors/platform-error.js';
import { assertValidPostRequest } from '../validation/validate-post-request.js';
import { detectPostType } from '../validation/detect-post-type.js';
import { validateAgainstCapabilities } from '../validation/capability-validator.js';
import type { PostRequest } from '../types/post-request.js';
import type { PostType } from '../types/post-type.js';
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
import { normalizeTarget } from '../types/target.js';
import type { PlatformCapabilities } from '../platforms/capabilities.js';
import type { IPlatform, ResolvedCapabilities } from '../platforms/platform.interface.js';
import type { QuotaState } from '../platforms/capabilities.js';
import { mergeCapabilities, validateCapabilities } from '../platforms/capabilities.js';
import type { ResolvedAccountConfig } from '../types/account-config.js';

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
  /**
   * Capabilities the host resolved for this account through
   * `IPlatform.resolveCapabilities()`. The library caches nothing, so a host
   * that wants runtime limits honoured passes what it fetched. Omitted means
   * the static descriptor applies.
   */
  capabilities?: PlatformCapabilities;
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
      const effectiveCapabilities = applyAccountBodyLimit(
        options.capabilities ?? platform.capabilities,
        accountConfig,
      );

      // Adapters see one target shape and one only: the normalized object,
      // with the account's default already applied.
      request = {
        ...request,
        target: normalizeTarget(request.target) ?? accountConfig.target,
      };

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

      const attempt = await this.withRequestTimeout(
        signal =>
          platform
            .publish(request, accountConfig, {
              signal,
              resume: options.resume,
              capabilities: effectiveCapabilities,
            })
            // The failure travels as a value rather than as a throw: a publish
            // whose outcome nobody confirmed is a third answer, not an error,
            // and choosing between the three is the next few lines' job.
            .then(
              published => ({ ok: true, published }) as const,
              (failure: unknown) => ({ ok: false, failure }) as const,
            ),
        options.signal,
      );

      if (!attempt.ok) {
        const failure = attempt.failure;
        if (!(failure instanceof PlatformError) || !failure.outcomeUnknown) {
          return this.toErrorResponse(failure, request, requestId, options.includeRaw ?? false);
        }
        const resolved = await this.resolveUnknownOutcome(
          failure,
          platform,
          accountConfig,
          request,
          effectiveCapabilities,
          options.signal,
        );
        if (!resolved.ok) {
          return this.toErrorResponse(
            resolved.failure,
            request,
            requestId,
            options.includeRaw ?? false,
          );
        }
        return this.buildResponse(resolved.published, request, postType, requestId, options);
      }

      const result = attempt.published;

      return this.buildResponse(result, request, postType, requestId, options);
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
        target: normalizeTarget(ref.target ?? request.target) ?? accountConfig.target,
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
          handle: this.guardResumeHandle(result.handle),
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

  /**
   * Decide what a failure whose outcome is unknown means.
   *
   * A `create` that timed out may or may not have published. Repeating it is
   * how a network ends up with two identical posts, so the core never does:
   * it asks the platform to find out (`reconcile`), accepts an idempotency key
   * as a guarantee that a repeat is safe, and otherwise hands the host
   * `UNKNOWN_OUTCOME` — an outcome to show, not an error to retry.
   */
  private async resolveUnknownOutcome(
    error: PlatformError,
    platform: IPlatform,
    accountConfig: ResolvedAccountConfig,
    request: PostRequest,
    capabilities: PlatformCapabilities,
    signal?: AbortSignal,
  ): Promise<
    | { ok: true; published: Awaited<ReturnType<IPlatform['publish']>> }
    | { ok: false; failure: unknown }
  > {
    const reconcile = platform.reconcile?.bind(platform);
    if (reconcile && error.resumeHandle) {
      const handle = error.resumeHandle;
      this.logger.warn(
        `Outcome of the publication to ${platform.name} is unknown; reconciling`,
        LOG_CONTEXT,
      );
      const outcome = await this.withRequestTimeout(
        reconcileSignal => reconcile(handle, accountConfig, reconcileSignal),
        signal,
      );
      if (outcome.status === 'published') {
        return {
          ok: true,
          published: {
            status: 'published',
            postId: outcome.postId,
            url: outcome.url,
            parts: outcome.parts,
            ref: outcome.ref,
          },
        };
      }
      if (outcome.status === 'absent') {
        // Nothing was created, so repeating the call is safe after all.
        return { ok: false, failure: retryableFailure(error) };
      }
    }

    if (capabilities.supportsIdempotencyKey && request.idempotencyKey) {
      // A repeat is deduplicated by the platform itself.
      return { ok: false, failure: retryableFailure(error) };
    }

    return {
      ok: false,
      failure: new PlatformError(
        `${platform.name} did not confirm the outcome of this publication, and it cannot be checked or safely repeated. Verify the account before publishing again.`,
        ErrorCode.UNKNOWN_OUTCOME,
        {
          retryable: false,
          httpStatus: error.httpStatus,
          platformCode: error.platformCode,
          resumeHandle: error.resumeHandle,
          cause: error,
          raw: error.raw,
        },
      ),
    };
  }

  /** The success payload, from whichever path produced the publication. */
  private buildResponse(
    result: Awaited<ReturnType<IPlatform['publish']>>,
    request: PostRequest,
    postType: PostType,
    requestId: string,
    options: PublishCallOptions,
  ): PostResponse {
    return {
      success: true,
      data: {
        status: result.status,
        postId: result.postId,
        url: result.url,
        parts: result.parts,
        ref: result.ref ?? {
          postId: result.postId,
          target: normalizeTarget(request.target),
          parts: result.parts,
        },
        handle: this.guardResumeHandle(result.handle),
        checkAfterMs: result.checkAfterMs,
        platform: request.platform,
        type: postType,
        publishedAt: new Date().toISOString(),
        raw: options.includeRaw ? result.raw : undefined,
        requestId,
      },
    };
  }

  /**
   * Ask a network what it accepts for one account, right now.
   *
   * The result is returned, never stored: `cacheableForSecs` says how long the
   * host may reuse it, and `0` — TikTok's Creator Info — means fetch again
   * before every publication. A library-side cache would be a cache the host
   * cannot invalidate.
   *
   * @param request - Enough of a request to resolve the platform and credentials.
   * @param signal - Aborts the lookup.
   * @returns The merged descriptor, with its freshness.
   */
  async resolveCapabilities(
    request: Pick<PostRequest, 'platform' | 'account' | 'auth'>,
    signal?: AbortSignal,
  ): Promise<ResolvedCapabilities> {
    const { platform, accountConfig } = await this.validateRequest(request);
    const resolve = platform.resolveCapabilities?.bind(platform);

    if (!resolve) {
      return {
        capabilities: applyAccountBodyLimit(platform.capabilities, accountConfig),
        fetchedAt: new Date().toISOString(),
      };
    }

    const runtime = await resolve(accountConfig, signal);
    const capabilities = applyAccountBodyLimit(
      mergeCapabilities(platform.capabilities, runtime.capabilities),
      accountConfig,
    );
    validateCapabilities(capabilities);
    return {
      capabilities,
      cacheableForSecs: runtime.cacheableForSecs,
      fetchedAt: runtime.fetchedAt,
    };
  }

  /**
   * Remaining allowance for an account, where the network reports one.
   *
   * @param request - Enough of a request to resolve the platform and credentials.
   * @param signal - Aborts the lookup.
   * @throws ValidationError when the platform has no quota endpoint.
   */
  async getQuota(
    request: Pick<PostRequest, 'platform' | 'account' | 'auth'>,
    signal?: AbortSignal,
  ): Promise<QuotaState> {
    const { platform, accountConfig } = await this.validateRequest(request);
    const getQuota = platform.getQuota?.bind(platform);
    if (!getQuota) {
      throw new ValidationError(`Platform "${platform.name}" does not report quota`);
    }
    return getQuota(accountConfig, signal);
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

    const payload = errorPayload(error, requestId, includeRaw);
    try {
      return {
        success: false,
        error: { ...payload, resumeHandle: this.guardResumeHandle(payload.resumeHandle) },
      };
    } catch (guardError) {
      // Strict mode: an adapter put a secret in a handle. That is a bug in the
      // adapter, and in development it must be the thing the caller sees.
      return {
        success: false,
        error: {
          code: ErrorCode.INTERNAL_ERROR,
          message: guardError instanceof Error ? guardError.message : 'Invalid resume handle',
          retryable: false,
          requestId,
        },
      };
    }
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

/** Preserve diagnostics while marking a proven-safe repeat as retryable. */
function retryableFailure(error: PlatformError): PlatformError {
  return new PlatformError(error.message, error.code, {
    retryable: true,
    retryAfterMs: error.retryAfterMs,
    httpStatus: error.httpStatus,
    platformCode: error.platformCode,
    resumeHandle: error.resumeHandle,
    cause: error.cause,
    raw: error.raw,
  });
}

/** Narrow a descriptor's body limit to the account's own, when it has one. */
function applyAccountBodyLimit(
  capabilities: PlatformCapabilities,
  accountConfig: ResolvedAccountConfig,
): PlatformCapabilities {
  if (accountConfig.maxBodyLength === undefined) {
    return capabilities;
  }
  return {
    ...capabilities,
    maxBodyLength:
      capabilities.maxBodyLength !== undefined
        ? Math.min(capabilities.maxBodyLength, accountConfig.maxBodyLength)
        : accountConfig.maxBodyLength,
  };
}
