import {
  type MediaInput,
  type MediaInputObject,
  type MediaType,
} from '../types/media-input.type.js';
import { BadRequestException } from '@nestjs/common';
import { type InputFile } from 'grammy';

/**
 * Helper class for working with MediaInput
 */
export class MediaInputHelper {
  private static normalizeSrc(src: unknown): string {
    if (typeof src !== 'string') {
      throw new BadRequestException('MediaInput.src must be a non-empty string');
    }

    const normalized = src.trim();
    if (normalized.length === 0) {
      throw new BadRequestException('MediaInput.src must be a non-empty string');
    }
    return normalized;
  }

  private static looksLikeHttpUrl(str: string): boolean {
    return /^https?:\/\//i.test(str.trim());
  }

  /**
   * Check if a string is a valid URL
   * @param str - String to check
   * @returns True if string is a valid URL
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
   * Type guard to check if MediaInput is an object with src property
   * @param input - MediaInput to check
   * @returns True if input is a MediaInputObject
   */
  static isObject(input: MediaInput): input is MediaInputObject {
    return typeof input === 'object' && input !== null;
  }

  /**
   * Extract URL from MediaInput
   * Checks if the src value is a valid URL
   * @param input - MediaInput to extract URL from
   * @returns URL string if available, undefined otherwise
   */
  static getUrl(input: MediaInput): string | undefined {
    if (this.isObject(input)) {
      const src = this.normalizeSrc(input.src);
      return this.isValidUrl(src) ? src : undefined;
    }
    return undefined;
  }

  /**
   * Extract Telegram file_id from MediaInput
   * Available when src is not a valid URL
   * @param input - MediaInput to extract file_id from
   * @returns Telegram file_id if available, undefined otherwise
   */
  static getFileId(input: MediaInput): string | undefined {
    if (this.isObject(input)) {
      const src = this.normalizeSrc(input.src);
      if (this.looksLikeHttpUrl(src) && !this.isValidUrl(src)) {
        throw new BadRequestException('Invalid media URL in MediaInput.src');
      }
      return this.isValidUrl(src) ? undefined : src;
    }
    return undefined;
  }

  /**
   * Extract hasSpoiler flag from MediaInput
   * Used for Telegram spoiler animation feature
   * @param input - MediaInput to extract flag from
   * @returns True if spoiler is enabled, false otherwise (defaults to false)
   */
  static getHasSpoiler(input: MediaInput): boolean {
    if (this.isObject(input)) {
      return input.hasSpoiler ?? false;
    }
    return false;
  }

  /**
   * Extract explicit media type from MediaInput
   * Used in media arrays to override auto-detection by URL extension
   * @param input - MediaInput to extract type from
   * @returns MediaType if specified, undefined otherwise
   */
  static getType(input: MediaInput): MediaType | undefined {
    if (this.isObject(input)) {
      return input.type;
    }
    return undefined;
  }

  /**
   * Convert MediaInput to Telegram-compatible format
   * Prioritizes file_id over URL for better performance and reliability
   * @param input - MediaInput to convert
   * @returns Telegram file_id string or URL string
   * @throws Error if src is missing or invalid
   */
  static toTelegramInput(input: MediaInput): string | InputFile {
    const fileId = this.getFileId(input);
    if (fileId) {
      return fileId;
    }

    const url = this.getUrl(input);
    if (url) {
      return url;
    }

    throw new BadRequestException(
      'MediaInput must be either a string or an object with src property',
    );
  }

  /**
   * Check if input has valid MediaInput structure
   * @param input - Input to check
   * @returns True if input is an object with src
   */
  static isValidShape(input: any): boolean {
    if (typeof input === 'object' && input !== null) {
      return typeof input.src === 'string' && input.src.trim().length > 0;
    }
    return false;
  }

  /**
   * Check if MediaInput array is not empty and contains valid items
   * @param input - Optional array of MediaInput
   * @returns True if array exists and has at least one valid element
   */
  static isNotEmpty(input?: MediaInput[]): boolean {
    return Array.isArray(input) && input.some(item => this.isValidShape(item));
  }

  /**
   * Check if MediaInput is defined, not null, and has valid shape
   * @param input - Optional MediaInput to check
   * @returns True if input is defined, not null, and valid
   */
  static isDefined(input?: MediaInput): boolean {
    return input !== undefined && input !== null && this.isValidShape(input);
  }
}
