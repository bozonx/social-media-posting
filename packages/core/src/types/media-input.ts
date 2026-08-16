/**
 * Media type for explicit type specification in media arrays
 * Used in albums to avoid auto-detection by URL extension
 */
export type MediaType = 'image' | 'video' | 'audio' | 'document';

/**
 * MediaInput type
 * Always an object with src and optional parameters
 * For single media fields (cover, video, audio, document): hasSpoiler is optional
 * For media arrays: type should be specified to override auto-detection
 */
export type MediaInput = MediaInputObject;

export interface MediaInputObject {
  /**
   * Media source (URL or Telegram file_id)
   */
  src: string;

  /**
   * Hide media with spoiler animation (for shocking content)
   * Supported by Telegram Bot API 5.6+
   */
  hasSpoiler?: boolean;

  /**
   * Explicit media type specification
   * For single media fields (cover, video, audio, document) this is ignored
   * For media[] arrays this overrides auto-detection by URL extension
   */
  type?: MediaType;
}
