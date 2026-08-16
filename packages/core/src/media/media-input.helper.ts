import type { MediaInput, MediaInputObject, MediaType } from '../types/media-input.js';
import { ValidationError } from '../errors/posting-error.js';

/**
 * Helpers for reading a {@link MediaInput} without every platform re-deriving
 * the same facts about it.
 */
export class MediaInputHelper {
  private static normalizeSrc(src: unknown): string {
    if (typeof src !== 'string') {
      throw new ValidationError('MediaInput.src must be a non-empty string');
    }

    const normalized = src.trim();
    if (normalized.length === 0) {
      throw new ValidationError('MediaInput.src must be a non-empty string');
    }
    return normalized;
  }

  private static looksLikeHttpUrl(str: string): boolean {
    return /^https?:\/\//i.test(str.trim());
  }

  /**
   * Check whether a string is an http(s) URL.
   * @param str - String to check.
   */
  private static isValidUrl(str: string): boolean {
    try {
      const trimmed = str.trim();
      if (/\s/.test(trimmed)) {
        return false;
      }

      const url = new URL(trimmed);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }

  /**
   * Type guard for a media input object.
   * @param input - MediaInput to check.
   */
  static isObject(input: MediaInput): input is MediaInputObject {
    return typeof input === 'object' && input !== null;
  }

  /**
   * Extract the http(s) URL from a media input.
   * @param input - MediaInput to read.
   * @returns The URL, or undefined when `src` is a platform-side reference.
   */
  static getUrl(input: MediaInput): string | undefined {
    if (this.isObject(input)) {
      const src = this.normalizeSrc(input.src);
      return this.isValidUrl(src) ? src : undefined;
    }
    return undefined;
  }

  /**
   * Extract the opaque platform-side reference from a media input — an
   * identifier for media the platform already stores (Telegram `file_id`,
   * VK attachment id, …).
   * @param input - MediaInput to read.
   * @returns The reference, or undefined when `src` is a URL.
   * @throws ValidationError if `src` looks like a URL but is malformed.
   */
  static getPlatformRef(input: MediaInput): string | undefined {
    if (this.isObject(input)) {
      const src = this.normalizeSrc(input.src);
      if (this.looksLikeHttpUrl(src) && !this.isValidUrl(src)) {
        throw new ValidationError('Invalid media URL in MediaInput.src');
      }
      return this.isValidUrl(src) ? undefined : src;
    }
    return undefined;
  }

  /**
   * Read the spoiler flag.
   * @param input - MediaInput to read.
   * @returns True when the media should be hidden behind a spoiler.
   */
  static getHasSpoiler(input: MediaInput): boolean {
    if (this.isObject(input)) {
      return input.hasSpoiler ?? false;
    }
    return false;
  }

  /**
   * Read the explicit media type, which overrides detection by URL extension.
   * @param input - MediaInput to read.
   */
  static getType(input: MediaInput): MediaType | undefined {
    if (this.isObject(input)) {
      return input.type;
    }
    return undefined;
  }

  /**
   * Check that a value has the structural shape of a media input.
   * @param input - Value to check.
   */
  static isValidShape(input: unknown): boolean {
    if (typeof input === 'object' && input !== null) {
      const src = (input as { src?: unknown }).src;
      return typeof src === 'string' && src.trim().length > 0;
    }
    return false;
  }

  /**
   * Check that a media array holds at least one well-formed item.
   * @param input - Optional array of MediaInput.
   */
  static isNotEmpty(input?: MediaInput[]): boolean {
    return Array.isArray(input) && input.some(item => this.isValidShape(item));
  }

  /**
   * Check that a media input is present and well-formed.
   * @param input - Optional MediaInput to check.
   */
  static isDefined(input?: MediaInput): boolean {
    return input !== undefined && input !== null && this.isValidShape(input);
  }
}
