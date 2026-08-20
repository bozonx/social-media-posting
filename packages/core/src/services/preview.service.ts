import { BasePostService } from './base-post.service.js';
import { validatePostRequest } from '../validation/validate-post-request.js';
import { detectPostType } from '../validation/detect-post-type.js';
import { previewFromCapabilities } from '../validation/capability-preview.js';
import { ErrorCode } from '../errors/error-code.js';
import { PostingError, ValidationError } from '../errors/posting-error.js';
import { PlatformError } from '../errors/platform-error.js';
import type { PostRequest } from '../types/post-request.js';
import type { PreviewResult } from '../types/preview-response.js';
import type { ErrorPayload } from '../types/post-response.js';

const LOG_CONTEXT = 'PreviewService';

/**
 * Validates a post and reports what publishing it would do, without publishing.
 */
export class PreviewService extends BasePostService {
  /**
   * Preview a post.
   * @param request - Post request to preview.
   * @returns The platform's preview or capability preview result.
   */
  async preview(request: PostRequest): Promise<PreviewResult> {
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

      if (platform.preview) {
        return await platform.preview(request, accountConfig);
      }

      const validateExtra = platform.validateExtra?.bind(platform);
      return previewFromCapabilities(request, effectiveCapabilities, {
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
