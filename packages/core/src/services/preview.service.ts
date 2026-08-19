import { BasePostService } from './base-post.service.js';
import { validatePostRequest } from '../validation/validate-post-request.js';
import { previewFromCapabilities } from '../validation/capability-preview.js';
import type { PostRequest } from '../types/post-request.js';
import type { PreviewErrorResponse, PreviewResult } from '../types/preview-response.js';

const LOG_CONTEXT = 'PreviewService';

/**
 * Validates a post and reports what publishing it would do, without publishing.
 */
export class PreviewService extends BasePostService {
  /**
   * Preview a post.
   * @param request - Post request to preview.
   * @returns The platform's preview, or the collected validation errors.
   */
  async preview(request: PostRequest): Promise<PreviewResult> {
    const structuralErrors = validatePostRequest(request);
    if (structuralErrors.length > 0) {
      return errorResponse(structuralErrors);
    }

    try {
      const { platform, accountConfig } = await this.validateRequest(request);
      const effectiveRequest = withAccountBodyLimit(request, accountConfig.maxBody);

      if (platform.preview) {
        return await platform.preview(effectiveRequest, accountConfig);
      }

      // No platform dry-run: the descriptor already says everything the checks
      // in publish() consult, so previewing from it cannot drift.
      const validateExtra = platform.validateExtra?.bind(platform);
      return previewFromCapabilities(effectiveRequest, platform.capabilities, {
        detectType: platform.detectType?.bind(platform),
        validateExtra: validateExtra
          ? (previewRequest, detectedType) =>
              validateExtra(previewRequest, accountConfig, detectedType)
          : undefined,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(
        `Preview validation failed for ${request.platform}: ${message}`,
        LOG_CONTEXT,
      );
      return errorResponse([message]);
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

function errorResponse(errors: string[]): PreviewErrorResponse {
  return {
    success: false,
    data: {
      valid: false,
      errors,
      warnings: [],
    },
  };
}
