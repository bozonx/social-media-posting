import type { PostType } from './post-type.js';
import type { MediaInput } from './media-input.js';

/**
 * Everything needed to publish a single post.
 *
 * A plain structural type on purpose: the core carries no decorator runtime and
 * no validation framework, so hosts can build this object any way they like.
 * Structural validation lives in `validatePostRequest()`.
 */
export interface PostRequest {
  /** Target social media platform (e.g. 'telegram'). */
  platform: string;

  /** Post content/text body (optional if media is provided). */
  body?: string;

  /** Post type (auto-detected when omitted or set to 'auto'). */
  type?: PostType;

  /**
   * Format of the body content.
   * Standard values: 'text', 'html', 'md'.
   * Platform-specific values (e.g. 'MarkdownV2' for Telegram) are also accepted.
   */
  bodyFormat?: string;

  /** Post title (used by platforms that support it). */
  title?: string;

  /** Post description/summary (used by platforms that support it). */
  description?: string;

  /** Cover image (for image posts or article thumbnails). */
  cover?: MediaInput;

  /** Video file (for video posts). */
  video?: MediaInput;

  /** Audio file (for audio posts). */
  audio?: MediaInput;

  /** Document file (for document posts). */
  document?: MediaInput;

  /** Multiple media files (for album/gallery posts). */
  media?: MediaInput[];

  /** Named account from configuration. */
  account?: string;

  /** Platform-agnostic channel/chat identifier (e.g. '@mychannel', -100123456789). */
  channelId?: string | number;

  /** Inline authentication credentials (alternative to `account`). */
  auth?: Record<string, unknown>;

  /** Platform-specific options passed straight through to the platform API. */
  options?: Record<string, unknown>;

  /** Disable notification (silent message). */
  disableNotification?: boolean;

  /** Post tags/hashtags. */
  tags?: string[];

  /** Scheduled publication time (ISO 8601). */
  scheduledAt?: string;

  /** Post language code (e.g. 'en', 'ru'). */
  postLanguage?: string;

  /** Publication mode: publish immediately or save as a draft. */
  mode?: 'publish' | 'draft';

  /** Maximum body length override (characters). */
  maxBody?: number;
}
