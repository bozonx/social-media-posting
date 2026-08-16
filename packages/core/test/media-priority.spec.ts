import { describe, it, expect } from 'vitest';
import { detectPrimaryMediaField } from '../src/media/media-priority.js';
import { PostType } from '../src/types/post-type.js';
import type { PostRequest } from '../src/types/post-request.js';

describe('detectPrimaryMediaField', () => {
  const baseRequest: PostRequest = {
    platform: 'telegram',
    body: 'Test body',
  };

  it('should detect ALBUM (Priority 1) when media[] is present', () => {
    const request: PostRequest = {
      ...baseRequest,
      media: [{ src: 'https://example.com/1.jpg' }],
      // Lower priority fields also present
      document: { src: 'https://example.com/file.pdf' },
      audio: { src: 'https://example.com/audio.mp3' },
      video: { src: 'https://example.com/video.mp4' },
    };

    expect(detectPrimaryMediaField(request)).toBe(PostType.ALBUM);
  });

  it('should detect DOCUMENT (Priority 2) when document is present and no media[]', () => {
    const request: PostRequest = {
      ...baseRequest,
      document: { src: 'https://example.com/file.pdf' },
      // Lower priority fields also present
      audio: { src: 'https://example.com/audio.mp3' },
      video: { src: 'https://example.com/video.mp4' },
    };

    expect(detectPrimaryMediaField(request)).toBe(PostType.DOCUMENT);
  });

  it('should detect AUDIO (Priority 3) when audio is present and no higher priority fields', () => {
    const request: PostRequest = {
      ...baseRequest,
      audio: { src: 'https://example.com/audio.mp3' },
      // Lower priority fields also present
      video: { src: 'https://example.com/video.mp4' },
    };

    expect(detectPrimaryMediaField(request)).toBe(PostType.AUDIO);
  });

  it('should detect VIDEO (Priority 4) when video is present and no higher priority fields', () => {
    const request: PostRequest = {
      ...baseRequest,
      video: { src: 'https://example.com/video.mp4' },
    };

    expect(detectPrimaryMediaField(request)).toBe(PostType.VIDEO);
  });

  it('should return null when no priority fields are present (only cover)', () => {
    const request: PostRequest = {
      ...baseRequest,
      cover: { src: 'https://example.com/image.jpg' },
    };

    expect(detectPrimaryMediaField(request)).toBeNull();
  });

  it('should return null when no media fields are present', () => {
    const request: PostRequest = {
      ...baseRequest,
    };

    expect(detectPrimaryMediaField(request)).toBeNull();
  });

  it('should handle MediaInput objects correctly', () => {
    const request: PostRequest = {
      ...baseRequest,
      audio: { src: 'https://example.com/audio.mp3' },
      video: { src: 'AgACAgIAAxkBAAIC...' },
    };

    // AUDIO > VIDEO
    expect(detectPrimaryMediaField(request)).toBe(PostType.AUDIO);
  });
});
