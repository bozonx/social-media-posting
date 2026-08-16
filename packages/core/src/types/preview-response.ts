import type { PostType } from './post-type.js';

/**
 * Successful preview result.
 */
export interface PreviewResponse {
  success: true;
  data: {
    valid: true;
    /** Detected post type based on content. */
    detectedType: PostType;
    /** Body content after conversion. */
    convertedBody?: string;
    /** Target format after conversion. */
    targetFormat: string;
    /** Length of converted body. */
    convertedBodyLength?: number;
    /** Validation warnings (non-blocking). */
    warnings: string[];
  };
}

/**
 * Preview result for a request that cannot be published.
 */
export interface PreviewErrorResponse {
  success: false;
  data: {
    valid: false;
    /** Validation errors (blocking). */
    errors: string[];
    /** Validation warnings (non-blocking). */
    warnings: string[];
  };
}

/** Either outcome of `PostingClient.preview()`. */
export type PreviewResult = PreviewResponse | PreviewErrorResponse;
