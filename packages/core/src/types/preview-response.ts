import type { PostType } from './post-type.js';
import type { Issue, ErrorPayload } from './post-response.js';
import type { RequestField } from '../platforms/capabilities.js';

/**
 * The outcome of `PostingClient.preview()`.
 */
export type PreviewResult =
  | {
      success: true;
      data: {
        /** Whether the post is valid for publication. */
        valid: boolean;
        /** Detected post type based on content. */
        detectedType: PostType;
        /** Blocking issues when valid is false. */
        issues: Issue[];
        /** Validation warnings (non-blocking). */
        warnings: Issue[];
        /** Fields that are accepted but will be ignored. */
        ignoredFields: RequestField[];
        /** Body content after conversion. */
        convertedBody?: string;
        /** Length of converted body. */
        convertedBodyLength?: number;
        /** Target format after conversion. */
        targetFormat?: string;
        /** Whether the converted body overflowed the limit and was truncated. */
        truncated?: boolean;
      };
    }
  | { success: false; error: ErrorPayload };
