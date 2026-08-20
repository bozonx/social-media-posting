/**
 * Supported post types across different social media platforms
 * AUTO allows the system to automatically detect the appropriate type based on content
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
  /** Audio file post */
  AUDIO: 'audio',
  /** Document file post */
  DOCUMENT: 'document',
  /** Story/status update (temporary content) */
  STORY: 'story',
  /** Poll/survey post */
  POLL: 'poll',
} as const;

export type PostType = (typeof PostType)[keyof typeof PostType] | (string & {});
