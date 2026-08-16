import { describe, it, expect } from 'vitest';
import { MediaInputHelper } from '../src/media/media-input.helper.js';
import { ValidationError } from '../src/errors/posting-error.js';

describe('MediaInputHelper', () => {
  describe('isObject', () => {
    it('should return true for object with src (URL)', () => {
      expect(MediaInputHelper.isObject({ src: 'https://example.com/image.jpg' })).toBe(true);
    });

    it('should return true for object with src (fileId)', () => {
      expect(MediaInputHelper.isObject({ src: 'AgACAgIAAxkBAAIC...' })).toBe(true);
    });

    it('should return false for null', () => {
      expect(MediaInputHelper.isObject(null as any)).toBe(false);
    });
  });

  describe('getUrl', () => {
    it('should return URL from object input', () => {
      expect(MediaInputHelper.getUrl({ src: 'https://example.com/image.jpg' })).toBe(
        'https://example.com/image.jpg',
      );
    });

    it('should return undefined for object with fileId src', () => {
      expect(MediaInputHelper.getUrl({ src: 'AgACAgIAAxkBAAIC...' })).toBeUndefined();
    });

    it('should return undefined for null', () => {
      expect(MediaInputHelper.getUrl(null as any)).toBeUndefined();
    });
  });

  describe('getPlatformRef', () => {
    it('should return fileId from object input', () => {
      expect(MediaInputHelper.getPlatformRef({ src: 'AgACAgIAAxkBAAIC...' })).toBe(
        'AgACAgIAAxkBAAIC...',
      );
    });

    it('should return undefined for object with URL src', () => {
      expect(
        MediaInputHelper.getPlatformRef({ src: 'https://example.com/image.jpg' }),
      ).toBeUndefined();
    });

    it('should throw ValidationError for invalid URL that looks like http(s) URL', () => {
      expect(() =>
        MediaInputHelper.getPlatformRef({ src: 'https://example.com/\nimage.jpg' }),
      ).toThrow(ValidationError);
    });
  });

  describe('getHasSpoiler', () => {
    it('should return true when hasSpoiler is true', () => {
      expect(
        MediaInputHelper.getHasSpoiler({ src: 'https://example.com/image.jpg', hasSpoiler: true }),
      ).toBe(true);
    });

    it('should return false when hasSpoiler is false', () => {
      expect(
        MediaInputHelper.getHasSpoiler({ src: 'https://example.com/image.jpg', hasSpoiler: false }),
      ).toBe(false);
    });

    it('should return false when hasSpoiler is not set', () => {
      expect(MediaInputHelper.getHasSpoiler({ src: 'https://example.com/image.jpg' })).toBe(false);
    });
  });

  describe('getType', () => {
    it('should return type from object input', () => {
      expect(
        MediaInputHelper.getType({
          src: 'https://example.com/image.jpg',
          type: 'image',
        } as any),
      ).toBe('image');
    });

    it('should return undefined when type is not set', () => {
      expect(
        MediaInputHelper.getType({
          src: 'https://example.com/image.jpg',
        } as any),
      ).toBeUndefined();
    });
  });

  describe('isNotEmpty', () => {
    it('should return true for non-empty array with objects', () => {
      expect(
        MediaInputHelper.isNotEmpty([
          { src: 'https://example.com/1.jpg' },
          { src: 'https://example.com/2.jpg' },
        ]),
      ).toBe(true);
    });

    it('should return true for array with single item', () => {
      expect(MediaInputHelper.isNotEmpty([{ src: 'https://example.com/1.jpg' }])).toBe(true);
    });

    it('should return false for empty array', () => {
      expect(MediaInputHelper.isNotEmpty([])).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(MediaInputHelper.isNotEmpty(undefined)).toBe(false);
    });

    it('should return false for null', () => {
      expect(MediaInputHelper.isNotEmpty(null as any)).toBe(false);
    });
  });

  describe('isDefined', () => {
    it('should return true for object', () => {
      expect(MediaInputHelper.isDefined({ src: 'https://example.com/image.jpg' })).toBe(true);
    });

    it('should return false for undefined', () => {
      expect(MediaInputHelper.isDefined(undefined)).toBe(false);
    });

    it('should return false for null', () => {
      expect(MediaInputHelper.isDefined(null as any)).toBe(false);
    });
  });
});
