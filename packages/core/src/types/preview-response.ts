import type { PostType } from './post-type.js';
import type { Issue, ErrorPayload } from './post-response.js';
import type { RequestField } from '../platforms/capabilities.js';
import type { PostRequest } from './post-request.js';
import type { PlatformTarget } from './target.js';
import type { MediaType } from './media-input.js';

/**
 * The request as the platform will actually receive it.
 *
 * A pure function of `(request, capabilities)` — no network call goes into
 * building it. It exists so a host does not keep a per-network formatter of its
 * own just to know what will be published.
 */
export interface AdaptedRequest {
  /** The type it will publish as. */
  type: PostType;
  /** Normalized address; adapters never see the scalar shorthand. */
  target?: PlatformTarget;
  /** Body after conversion and truncation. */
  body?: string;
  /** Format the body was converted to. */
  bodyFormat?: string;
  /** Audience, with the platform's default applied when the caller named none. */
  visibility?: string;
  /** Media, in publication order, with each item's resolved kind. */
  media?: Array<{ index: number; kind: MediaType; sourceKind: string; altText?: string }>;
  /** Fields the platform drops, removed from the request rather than passed on. */
  droppedFields: RequestField[];
  /** Everything else, carried through unchanged. */
  request: PostRequest;
}

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
        /**
         * How long a media URL must keep working after publication, in seconds,
         * for the networks that fetch media themselves. The host sizes the
         * lifetime of its signed URLs from this.
         */
        requiredMediaUrlLifetimeSecs?: number;
        /** The request as the platform will receive it. */
        adaptedRequest?: AdaptedRequest;
      };
    }
  | { success: false; error: ErrorPayload };
