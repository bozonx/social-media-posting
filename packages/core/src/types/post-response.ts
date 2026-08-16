import type { PostType } from './post-type.js';
import type { ErrorCode } from '../errors/error-code.js';

/**
 * Successful post publication result.
 */
export interface PostResponse {
  success: true;
  data: {
    /** Platform-specific post ID. */
    postId: string;
    /** Public URL to the post (if the platform exposes one). */
    url?: string;
    /** Platform name. */
    platform: string;
    /** Actual post type used. */
    type: PostType;
    /** Publication timestamp (ISO 8601). */
    publishedAt: string;
    /** Raw response from the platform API. */
    raw?: Record<string, unknown>;
    /** Unique request identifier for tracking. */
    requestId: string;
  };
}

/**
 * Failed post publication result.
 */
export interface ErrorResponse {
  success: false;
  error: {
    /** Error code for categorization. */
    code: ErrorCode;
    /** Human-readable error message. */
    message: string;
    /** Additional error details. */
    details?: Record<string, unknown>;
    /** Raw error payload from the platform API. */
    raw?: unknown;
    /** Unique request identifier for tracking. */
    requestId: string;
  };
}

/** Either outcome of `PostingClient.post()`. */
export type PostResult = PostResponse | ErrorResponse;
