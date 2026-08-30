import { describe, expect, it } from 'vitest';
import { knownSizeBytes, requiresByteUpload, toMediaSource } from '../src/media/media-source.js';
import { ValidationError } from '../src/errors/posting-error.js';
import { PostType } from '../src/types/post-type.js';
import type { PlatformCapabilities } from '../src/platforms/capabilities.js';
import type { MediaSource } from '../src/media/media-source.js';

const baseCapabilities: PlatformCapabilities = {
  name: 'test-platform',
  postTypes: {
    [PostType.IMAGE]: { requiredFields: ['media'] },
    [PostType.POST]: { requiredFields: ['body'] },
  },
};

describe('media-source', () => {
  describe('toMediaSource', () => {
    it('creates a UrlMediaSource from an http URL', () => {
      const source = toMediaSource({
        source: { kind: 'url', url: 'http://cdn.example.com/image.jpg' },
      });
      expect(source).toEqual({
        kind: 'url',
        url: 'http://cdn.example.com/image.jpg',
      });
    });

    it('creates a UrlMediaSource from an https URL', () => {
      const source = toMediaSource({
        source: { kind: 'url', url: 'https://cdn.example.com/photo.png' },
      });
      expect(source).toEqual({
        kind: 'url',
        url: 'https://cdn.example.com/photo.png',
      });
    });

    it('creates a PlatformRefMediaSource from a platform file ID', () => {
      const source = toMediaSource({ source: { kind: 'platformRef', ref: 'AgACAgIAAxkBAAIC4' } });
      expect(source).toEqual({
        kind: 'platformRef',
        ref: 'AgACAgIAAxkBAAIC4',
      });
    });

    it('throws ValidationError when MediaInput has no valid source', () => {
      expect(() => toMediaSource({} as never)).toThrow(ValidationError);
      expect(() => toMediaSource({ source: { kind: 'url', url: '' } } as never)).toThrow(
        ValidationError,
      );
    });
  });

  describe('requiresByteUpload', () => {
    it('returns false for platform references', () => {
      const source: MediaSource = { kind: 'platformRef', ref: 'ref-123' };
      expect(requiresByteUpload(source, baseCapabilities)).toBe(false);
    });

    it('returns false for URL sources when platform accepts url', () => {
      const source: MediaSource = { kind: 'url', url: 'https://example.com/a.jpg' };
      const capabilities: PlatformCapabilities = {
        ...baseCapabilities,
        media: {
          image: { acceptedSources: ['url', 'bytes'], transport: 'both' },
        },
      };
      expect(requiresByteUpload(source, capabilities, 'image')).toBe(false);
    });

    it('returns true for URL sources when platform does not accept url', () => {
      const source: MediaSource = { kind: 'url', url: 'https://example.com/a.jpg' };
      const capabilities: PlatformCapabilities = {
        ...baseCapabilities,
        media: {
          image: { acceptedSources: ['bytes'], transport: 'push' },
        },
      };
      expect(requiresByteUpload(source, capabilities, 'image')).toBe(true);
    });

    it('returns true for in-memory bytes sources', () => {
      const source: MediaSource = { kind: 'bytes', bytes: new Uint8Array([1, 2, 3]) };
      expect(requiresByteUpload(source, baseCapabilities)).toBe(true);
    });

    it('returns true for Blob sources', () => {
      const source: MediaSource = { kind: 'blob', blob: new Blob(['data']) };
      expect(requiresByteUpload(source, baseCapabilities)).toBe(true);
    });

    it('returns true for Stream sources', () => {
      const source: MediaSource = {
        kind: 'stream',
        open: async () => new ReadableStream(),
      };
      expect(requiresByteUpload(source, baseCapabilities)).toBe(true);
    });
  });

  describe('knownSizeBytes', () => {
    it('returns byteLength for bytes sources', () => {
      const bytes = new Uint8Array([1, 2, 3, 4, 5]);
      expect(knownSizeBytes({ kind: 'bytes', bytes })).toBe(5);
    });

    it('returns size for Blob sources', () => {
      const blob = new Blob(['hello world']);
      expect(knownSizeBytes({ kind: 'blob', blob })).toBe(11);
    });

    it('returns sizeBytes for Stream sources when set', () => {
      const source: MediaSource = {
        kind: 'stream',
        open: async () => new ReadableStream(),
        sizeBytes: 1024,
      };
      expect(knownSizeBytes(source)).toBe(1024);
    });

    it('returns undefined for Stream sources when sizeBytes is omitted', () => {
      const source: MediaSource = {
        kind: 'stream',
        open: async () => new ReadableStream(),
      };
      expect(knownSizeBytes(source)).toBeUndefined();
    });

    it('returns undefined for URL sources', () => {
      expect(knownSizeBytes({ kind: 'url', url: 'https://example.com/a.jpg' })).toBeUndefined();
    });

    it('returns undefined for platformRef sources', () => {
      expect(knownSizeBytes({ kind: 'platformRef', ref: 'ref-1' })).toBeUndefined();
    });
  });
});
