import type { PostType } from './post-type.js';
import type { MediaInput, ThumbnailInput } from './media-input.js';
import type { JsonValue } from './resume-handle.js';
import type { TargetInput } from './target.js';
import type { ArticleDocument } from './article-document.js';

/**
 * Everything needed to publish a single post.
 *
 * A plain structural type on purpose: the core carries no decorator runtime and
 * no validation framework, so hosts can build this object any way they like.
 * Structural validation lives in `validatePostRequest()`.
 *
 * `TExtra` is compile-time ergonomics for a host that knows which network it is
 * addressing (`PostRequest<TelegramExtra>`); the runtime authority on `extra`
 * remains `capabilities.extraFields`.
 */
export interface PostRequest<TExtra = Record<string, unknown>> {
  // — routing —
  platform: string;
  account?: string;
  auth?: Record<string, unknown>;
  /**
   * Where on the platform to publish: channel, page, board, community, profile.
   * A scalar is shorthand for `{ id: String(value) }`; adapters only ever see
   * the normalized {@link PlatformTarget}.
   */
  target?: TargetInput;

  // — content —
  body?: string;
  bodyFormat?: string;
  type?: PostType;
  title?: string;
  description?: string;
  tags?: string[];
  language?: string;
  /** Required by `PostType.ARTICLE`, refused by every other type. */
  article?: ArticleDocument;
  /**
   * Segments to publish as one chain. Never produced by splitting `body`:
   * where a text is cut is the caller's decision, never the library's.
   */
  thread?: PostSegment[];

  // — media —
  /** The only publishable media collection. Its order is preserved. */
  media?: MediaInput[];
  /** Preview image for a video or an article. Never publishable content on its own. */
  thumbnail?: ThumbnailInput;

  // — audience and moderation —
  visibility?: Visibility;
  sensitive?: boolean;
  contentWarning?: string;
  commentsEnabled?: boolean;

  // — structure —
  /** Publish as a reply/comment to an existing post. */
  inReplyTo?: PlatformObjectRef;
  /** Republish an existing post; a `body` alongside it makes it a quote. */
  repostOf?: PlatformObjectRef;
  poll?: PollInput;
  location?: LocationInput;

  // — delivery —
  scheduledAt?: string;
  mode?: 'publish' | 'draft';
  silent?: boolean;
  /** Passed to networks that deduplicate on it (Mastodon `Idempotency-Key`). */
  idempotencyKey?: string;

  // — escape hatch, declared by the platform —
  extra?: TExtra;
}

/** One message of a thread. */
export interface PostSegment {
  body?: string;
  media?: MediaInput[];
  poll?: PollInput;
}

/** Standard audiences, plus any value a platform declares. */
export type Visibility = 'public' | 'unlisted' | 'followers' | 'private' | 'direct' | (string & {});

export interface PlatformObjectRef {
  /** Platform-native object identifier. */
  id: string;
  /** Source channel/community when an id alone is not globally addressable. */
  target?: TargetInput;
  /** Adapter-defined addressing data, e.g. a Telegram source chat id. */
  extra?: Record<string, JsonValue>;
}

export interface PollInput {
  options: string[];
  durationSecs?: number;
  multiple?: boolean;
  anonymous?: boolean;
}

/** Exactly one of coordinates or placeId is required. Coordinates are supplied as a pair. */
export type LocationInput =
  | { latitude: number; longitude: number; name?: string; placeId?: never }
  | { placeId: string; name?: string; latitude?: never; longitude?: never };
