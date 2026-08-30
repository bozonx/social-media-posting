/**
 * Supported post types across different social media platforms.
 *
 * These names are the single source of truth. A platform descriptor may only
 * declare a type from this list or a namespaced extension (`x-<platform>-…`);
 * anything else fails at module registration rather than at publish time.
 */
export const PostType = {
  /** Automatically detect post type based on provided media fields */
  AUTO: 'auto',
  /** Text-only post without media */
  POST: 'post',
  /** Long-form article with rich formatting */
  ARTICLE: 'article',
  /** Single image post */
  IMAGE: 'image',
  /** Multiple images/videos in a single post */
  ALBUM: 'album',
  /** Video post */
  VIDEO: 'video',
  /** Short vertical video: Reels, Shorts, TikTok. Never inferred, always explicit. */
  SHORT_VIDEO: 'shortVideo',
  /** Audio file post */
  AUDIO: 'audio',
  /** Document file post */
  DOCUMENT: 'document',
  /** Story/status update (temporary content) */
  STORY: 'story',
  /** A chain of segments published as one conversation. Reserved. */
  THREAD: 'thread',
  /** Calendar event. Reserved: no adapter implements it yet. */
  EVENT: 'event',
  /** Live broadcast. Reserved: no adapter implements it yet. */
  LIVE: 'live',
  /** Poll/survey post */
  POLL: 'poll',
} as const;

export type PostType = (typeof PostType)[keyof typeof PostType] | (string & {});

/**
 * Every canonical type name, `auto` included.
 *
 * `auto` is a request-side instruction rather than a publishable type, so
 * {@link validateCapabilities} still refuses it as a `postTypes` key.
 */
export const CANONICAL_POST_TYPES: readonly string[] = Object.freeze(Object.values(PostType));

/**
 * A platform may name a type of its own, but only inside its own namespace,
 * e.g. `x-telegram-videoNote`.
 */
export const PLATFORM_POST_TYPE_PATTERN = /^x-[a-z0-9]+-[A-Za-z0-9-]+$/;

/**
 * Whether a name is one of the canonical type names.
 * @param name - The candidate type name.
 */
export function isCanonicalPostType(name: string): boolean {
  return CANONICAL_POST_TYPES.includes(name);
}

/**
 * Whether a name is a namespaced platform extension (`x-<platform>-…`).
 * @param name - The candidate type name.
 */
export function isPlatformPostType(name: string): boolean {
  return PLATFORM_POST_TYPE_PATTERN.test(name);
}
