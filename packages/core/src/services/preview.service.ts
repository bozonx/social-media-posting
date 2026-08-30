import { BasePostService } from './base-post.service.js';
import { validatePostRequest } from '../validation/validate-post-request.js';
import { detectPostType } from '../validation/detect-post-type.js';
import { previewFromCapabilities } from '../validation/capability-preview.js';
import { ErrorCode } from '../errors/error-code.js';
import { PostingError, ValidationError } from '../errors/posting-error.js';
import { PlatformError } from '../errors/platform-error.js';
import type { PostRequest } from '../types/post-request.js';
import { normalizeTarget } from '../types/target.js';
import type { PlatformCapabilities } from '../platforms/capabilities.js';
import type { PreviewResult } from '../types/preview-response.js';
import type { ErrorPayload } from '../types/post-response.js';

const LOG_CONTEXT = 'PreviewService';

/**
 * Validates a post and reports what publishing it would do, without publishing.
 */
/** Options for one `preview()` call. */
export interface PreviewCallOptions {
  /**
   * Capabilities the host resolved for this account. Without them the static
   * descriptor is used, and a network with per-account limits will be
   * previewed optimistically.
   */
  capabilities?: PlatformCapabilities;
}

export class PreviewService extends BasePostService {
  /**
   * Preview a post.
   * @param request - Post request to preview.
   * @param options - Resolved capabilities, when the host fetched them.
   * @returns The platform's preview or capability preview result.
   */
  async preview(request: PostRequest, options: PreviewCallOptions = {}): Promise<PreviewResult> {
    const structuralIssues = validatePostRequest(request);
    if (structuralIssues.length > 0) {
      const detectedType = detectPostType(request);
      return {
        success: true,
        data: {
          valid: false,
          detectedType,
          issues: structuralIssues,
          warnings: [],
          ignoredFields: [],
        },
      };
    }

    try {
      const { platform, accountConfig } = await this.validateRequest(request);
      const base = options.capabilities ?? platform.capabilities;
      const effectiveCapabilities =
        accountConfig.maxBodyLength !== undefined
          ? {
              ...base,
              maxBodyLength:
                base.maxBodyLength !== undefined
                  ? Math.min(base.maxBodyLength, accountConfig.maxBodyLength)
                  : accountConfig.maxBodyLength,
            }
          : base;

      const normalized: PostRequest = {
        ...request,
        target: normalizeTarget(request.target) ?? accountConfig.target,
      };

      if (platform.preview) {
        return await platform.preview(normalized, accountConfig);
      }

      const validateExtra = platform.validateExtra?.bind(platform);
      return previewFromCapabilities(normalized, effectiveCapabilities, {
        detectType: platform.detectType?.bind(platform),
        validateExtra: validateExtra
          ? (previewRequest, detectedType) =>
              validateExtra(previewRequest, accountConfig, detectedType)
          : undefined,
      });
    } catch (error) {
      const requestId = crypto.randomUUID();
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(
        `Preview validation failed for ${request.platform}: ${message}`,
        LOG_CONTEXT,
      );
      return {
        success: false,
        error: errorPayload(error, requestId),
      };
    }
  }
}

function errorPayload(error: unknown, requestId: string): ErrorPayload {
  if (error instanceof PlatformError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      retryAfterMs: error.retryAfterMs,
      httpStatus: error.httpStatus,
      platformCode: error.platformCode,
      resumeHandle: error.resumeHandle,
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
      requestId,
    };
  }

  const err = (error ?? {}) as { message?: string };
  return {
    code: ErrorCode.INTERNAL_ERROR,
    message: err.message ?? 'Unknown error',
    retryable: false,
    requestId,
  };
}
