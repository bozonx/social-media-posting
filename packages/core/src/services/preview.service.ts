import { BasePostService } from './base-post.service.js';
import { validatePostRequest } from '../validation/validate-post-request.js';
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
      const { platform, accountConfig } = this.validateRequest(request);
      return await platform.preview(request, accountConfig);
    } catch (error) {
      const message = (error as Error)?.message ?? 'Unknown error';
      this.logger.warn(
        `Preview validation failed for ${request.platform}: ${message}`,
        LOG_CONTEXT,
      );
      return errorResponse([message]);
    }
  }
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
