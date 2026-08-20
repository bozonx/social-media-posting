import { describe, it, expect } from 'vitest';
import { MediaInputHelper } from '../src/media/media-input.helper.js';

describe('MediaInputHelper', () => {
  describe('isObject', () => {
    it('should return true for object with source', () => {
      expect(
        MediaInputHelper.isObject({
          source: { kind: 'url', url: 'https://example.com/image.jpg' },
        }),
      ).toBe(true);
    });

    it('should return false for null and primitives', () => {
      expect(MediaInputHelper.isObject(null)).toBe(false);
      expect(MediaInputHelper.isObject('string')).toBe(false);
      expect(MediaInputHelper.isObject(123)).toBe(false);
    });
  });

  describe('isSource', () => {
    it('should return true for valid source shapes', () => {
      expect(MediaInputHelper.isSource({ kind: 'url', url: 'https://a/b.jpg' })).toBe(true);
      expect(MediaInputHelper.isSource({ kind: 'platformRef', ref: 'ref-1' })).toBe(true);
      expect(MediaInputHelper.isSource({ kind: 'bytes', bytes: new Uint8Array() })).toBe(true);
      expect(MediaInputHelper.isSource({ kind: 'blob', blob: new Blob() })).toBe(true);
      expect(
        MediaInputHelper.isSource({ kind: 'stream', open: async () => new ReadableStream() }),
      ).toBe(true);
    });

    it('should return false for invalid sources', () => {
      expect(MediaInputHelper.isSource(null)).toBe(false);
      expect(MediaInputHelper.isSource({ kind: 'unknown' })).toBe(false);
      expect(MediaInputHelper.isSource({})).toBe(false);
    });
  });

  describe('isValidShape', () => {
    it('should return true for valid MediaInput object', () => {
      expect(
        MediaInputHelper.isValidShape({
          source: { kind: 'url', url: 'https://example.com/image.jpg' },
        }),
      ).toBe(true);
    });

    it('should return false for invalid MediaInput', () => {
      expect(MediaInputHelper.isValidShape(null)).toBe(false);
      expect(MediaInputHelper.isValidShape({})).toBe(false);
      expect(MediaInputHelper.isValidShape({ source: 'not-an-object' })).toBe(false);
    });
  });

  describe('isNotEmpty', () => {
    it('should return true for non-empty array with valid objects', () => {
      expect(
        MediaInputHelper.isNotEmpty([
          { source: { kind: 'url', url: 'https://example.com/1.jpg' } },
        ]),
      ).toBe(true);
    });

    it('should return false for empty or invalid array', () => {
      expect(MediaInputHelper.isNotEmpty([])).toBe(false);
      expect(MediaInputHelper.isNotEmpty(undefined)).toBe(false);
      expect(MediaInputHelper.isNotEmpty(null as never)).toBe(false);
    });
  });

  describe('isDefined', () => {
    it('should return true for valid defined object', () => {
      expect(
        MediaInputHelper.isDefined({
          source: { kind: 'url', url: 'https://example.com/image.jpg' },
        }),
      ).toBe(true);
    });

    it('should return false for undefined or invalid', () => {
      expect(MediaInputHelper.isDefined(undefined)).toBe(false);
      expect(MediaInputHelper.isDefined({} as never)).toBe(false);
    });
  });
});
