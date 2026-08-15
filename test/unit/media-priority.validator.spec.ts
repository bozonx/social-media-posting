import { describe, it, expect } from '@jest/globals';
import { MediaPriorityValidator } from '@/common/validators/media-priority.validator.js';
import type { PostRequestDto } from '@/modules/post/dto/index.js';
import { PostType } from '@/common/enums/index.js';

describe('MediaPriorityValidator', () => {
  const baseRequest: PostRequestDto = {
    platform: 'telegram',
    body: 'Test body',
  };

  it('should detect ALBUM (Priority 1) when media[] is present', () => {
    const request: PostRequestDto = {
      ...baseRequest,
      media: [{ src: 'https://example.com/1.jpg' }],
      // Lower priority fields also present
      document: { src: 'https://example.com/file.pdf' },
      audio: { src: 'https://example.com/audio.mp3' },
      video: { src: 'https://example.com/video.mp4' },
    };

    expect(MediaPriorityValidator.detectPrimaryMediaField(request)).toBe(PostType.ALBUM);
  });

  it('should detect DOCUMENT (Priority 2) when document is present and no media[]', () => {
    const request: PostRequestDto = {
      ...baseRequest,
      document: { src: 'https://example.com/file.pdf' },
      // Lower priority fields also present
      audio: { src: 'https://example.com/audio.mp3' },
      video: { src: 'https://example.com/video.mp4' },
    };

    expect(MediaPriorityValidator.detectPrimaryMediaField(request)).toBe(PostType.DOCUMENT);
  });

  it('should detect AUDIO (Priority 3) when audio is present and no higher priority fields', () => {
    const request: PostRequestDto = {
      ...baseRequest,
      audio: { src: 'https://example.com/audio.mp3' },
      // Lower priority fields also present
      video: { src: 'https://example.com/video.mp4' },
    };

    expect(MediaPriorityValidator.detectPrimaryMediaField(request)).toBe(PostType.AUDIO);
  });

  it('should detect VIDEO (Priority 4) when video is present and no higher priority fields', () => {
    const request: PostRequestDto = {
      ...baseRequest,
      video: { src: 'https://example.com/video.mp4' },
    };

    expect(MediaPriorityValidator.detectPrimaryMediaField(request)).toBe(PostType.VIDEO);
  });

  it('should return null when no priority fields are present (only cover)', () => {
    const request: PostRequestDto = {
      ...baseRequest,
      cover: { src: 'https://example.com/image.jpg' },
    };

    expect(MediaPriorityValidator.detectPrimaryMediaField(request)).toBeNull();
  });

  it('should return null when no media fields are present', () => {
    const request: PostRequestDto = {
      ...baseRequest,
    };

    expect(MediaPriorityValidator.detectPrimaryMediaField(request)).toBeNull();
  });

  it('should handle MediaInput objects correctly', () => {
    const request: PostRequestDto = {
      ...baseRequest,
      audio: { src: 'https://example.com/audio.mp3' },
      video: { src: 'AgACAgIAAxkBAAIC...' },
    };

    // AUDIO > VIDEO
    expect(MediaPriorityValidator.detectPrimaryMediaField(request)).toBe(PostType.AUDIO);
  });
});
