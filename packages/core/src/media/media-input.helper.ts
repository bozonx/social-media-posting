import type { MediaInput, MediaSourceInput } from '../types/media-input.js';

/**
 * Type guards and validation helpers for {@link MediaInput}.
 */
export class MediaInputHelper {
  /**
   * Type guard for a media input object.
   */
  static isObject(input: unknown): input is MediaInput {
    return typeof input === 'object' && input !== null;
  }

  /**
   * Type guard for a media source input.
   */
  static isSource(source: unknown): source is MediaSourceInput {
    if (typeof source !== 'object' || source === null) {
      return false;
    }
    const kind = (source as { kind?: unknown }).kind;
    return (
      typeof kind === 'string' && ['url', 'bytes', 'blob', 'stream', 'platformRef'].includes(kind)
    );
  }

  /**
   * Check that a value has the structural shape of a valid media input.
   */
  static isValidShape(input: unknown): input is MediaInput {
    if (typeof input === 'object' && input !== null) {
      const source = (input as { source?: unknown }).source;
      return this.isSource(source);
    }
    return false;
  }

  /**
   * Check that a media array holds at least one well-formed item.
   */
  static isNotEmpty(input?: MediaInput[]): input is [MediaInput, ...MediaInput[]] {
    return Array.isArray(input) && input.length > 0 && input.some(item => this.isValidShape(item));
  }

  /**
   * Check that a media input is present and well-formed.
   */
  static isDefined(input?: MediaInput): input is MediaInput {
    return input !== undefined && this.isValidShape(input);
  }
}
