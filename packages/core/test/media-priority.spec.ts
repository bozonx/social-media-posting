import { describe, it, expect } from 'vitest';
import { detectPrimaryMediaField } from '../src/media/media-priority.js';
import { PostType } from '../src/types/post-type.js';
import type { PostRequest } from '../src/types/post-request.js';

describe('detectPrimaryMediaField', () => {
  const baseRequest: PostRequest = {
    platform: 'telegram',
    body: 'Test body',
  };

  it('should detect ALBUM when media[] has multiple items', () => {
    const request: PostRequest = {
      ...baseRequest,
      media: [
        { source: { kind: 'url', url: 'https://example.com/1.jpg' } },
        { source: { kind: 'url', url: 'https://example.com/2.jpg' } },
      ],
    };

    expect(detectPrimaryMediaField(request)).toBe(PostType.ALBUM);
  });

  it('should detect DOCUMENT when single media has document type or extension', () => {
    const request: PostRequest = {
      ...baseRequest,
      media: [{ source: { kind: 'url', url: 'https://example.com/file.pdf' } }],
    };

    expect(detectPrimaryMediaField(request)).toBe(PostType.DOCUMENT);
  });

  it('should detect AUDIO when single media has audio type or extension', () => {
    const request: PostRequest = {
      ...baseRequest,
      media: [{ source: { kind: 'url', url: 'https://example.com/audio.mp3' } }],
    };

    expect(detectPrimaryMediaField(request)).toBe(PostType.AUDIO);
  });

  it('should detect VIDEO when single media has video type or extension', () => {
    const request: PostRequest = {
      ...baseRequest,
      media: [{ source: { kind: 'url', url: 'https://example.com/video.mp4' } }],
    };

    expect(detectPrimaryMediaField(request)).toBe(PostType.VIDEO);
  });

  it('should detect IMAGE when single media has image type or extension', () => {
    const request: PostRequest = {
      ...baseRequest,
      media: [{ source: { kind: 'url', url: 'https://example.com/image.jpg' } }],
    };

    expect(detectPrimaryMediaField(request)).toBe(PostType.IMAGE);
  });

  it('should return null when no media is present', () => {
    const request: PostRequest = {
      ...baseRequest,
    };

    expect(detectPrimaryMediaField(request)).toBeNull();
  });
});
