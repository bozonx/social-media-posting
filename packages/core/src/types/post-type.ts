/**
 * Supported post types across different social media platforms
 * AUTO allows the system to automatically detect the appropriate type based on content
 */
export enum PostType {
  /** Automatically detect post type based on provided media fields */
  AUTO = 'auto',
  /** Text-only post without media */
  POST = 'post',
  /** Long-form article with rich formatting */
  ARTICLE = 'article',
  /** Single image post */
  IMAGE = 'image',
  /** Multiple images/videos in a single post */
  ALBUM = 'album',
  /** Video post */
  VIDEO = 'video',
  /** Short-form video (e.g., TikTok, Reels) */
  SHORT = 'short',
  /** Audio file post */
  AUDIO = 'audio',
  /** Document file post */
  DOCUMENT = 'document',
  /** Story/status update (temporary content) */
  STORY = 'story',
  /** Poll/survey post */
  POLL = 'poll',
}
