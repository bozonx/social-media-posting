import { describe, it, expect, beforeEach } from 'vitest';
import { PostType } from '@bozonx/social-posting';
import type { PostRequest } from '@bozonx/social-posting';
import { TelegramTypeDetector } from '../src/telegram-type-detector.js';

describe('TelegramTypeDetector', () => {
  let detector: TelegramTypeDetector;

  beforeEach(() => {
    detector = new TelegramTypeDetector();
  });

  const baseRequest: PostRequest = {
    platform: 'telegram',
    body: 'Test body',
  };

  it('should return explicit type when not AUTO', () => {
    const request: PostRequest = {
      ...baseRequest,
      type: PostType.VIDEO,
      cover: { src: 'https://example.com/image.jpg' },
    };

    const result = detector.detectType(request);

    expect(result).toBe(PostType.VIDEO);
  });

  it('should detect ALBUM when media array is not empty', () => {
    const request: PostRequest = {
      ...baseRequest,
      type: PostType.AUTO,
      media: [{ src: 'https://example.com/1.jpg' }, { src: 'https://example.com/2.jpg' }],
    };

    const result = detector.detectType(request);

    expect(result).toBe(PostType.ALBUM);
  });

  it('should detect DOCUMENT when document is present', () => {
    const request: PostRequest = {
      ...baseRequest,
      type: PostType.AUTO,
      document: { src: 'https://example.com/file.pdf' },
    };

    const result = detector.detectType(request);

    expect(result).toBe(PostType.DOCUMENT);
  });

  it('should detect AUDIO when audio is present', () => {
    const request: PostRequest = {
      ...baseRequest,
      type: PostType.AUTO,
      audio: { src: 'https://example.com/audio.mp3' },
    };

    const result = detector.detectType(request);

    expect(result).toBe(PostType.AUDIO);
  });

  it('should detect VIDEO when video is present', () => {
    const request: PostRequest = {
      ...baseRequest,
      type: PostType.AUTO,
      video: { src: 'https://example.com/video.mp4' },
    };

    const result = detector.detectType(request);

    expect(result).toBe(PostType.VIDEO);
  });

  it('should detect IMAGE when cover is present', () => {
    const request: PostRequest = {
      ...baseRequest,
      type: PostType.AUTO,
      cover: { src: 'https://example.com/image.jpg' },
    };

    const result = detector.detectType(request);

    expect(result).toBe(PostType.IMAGE);
  });

  it('should detect POST when no media fields are present', () => {
    const request: PostRequest = {
      ...baseRequest,
      type: PostType.AUTO,
    };

    const result = detector.detectType(request);

    expect(result).toBe(PostType.POST);
  });

  it('should respect priority: media over other fields', () => {
    const request: PostRequest = {
      ...baseRequest,
      type: PostType.AUTO,
      media: [{ src: 'https://example.com/1.jpg' }],
      document: { src: 'https://example.com/file.pdf' },
      audio: { src: 'https://example.com/audio.mp3' },
      video: { src: 'https://example.com/video.mp4' },
      cover: { src: 'https://example.com/cover.jpg' },
    };

    const result = detector.detectType(request);

    expect(result).toBe(PostType.ALBUM);
  });

  it('should respect priority: document over audio/video/cover', () => {
    const request: PostRequest = {
      ...baseRequest,
      type: PostType.AUTO,
      document: { src: 'https://example.com/file.pdf' },
      audio: { src: 'https://example.com/audio.mp3' },
      video: { src: 'https://example.com/video.mp4' },
      cover: { src: 'https://example.com/cover.jpg' },
    };

    const result = detector.detectType(request);

    expect(result).toBe(PostType.DOCUMENT);
  });

  it('should respect priority: audio over video/cover', () => {
    const request: PostRequest = {
      ...baseRequest,
      type: PostType.AUTO,
      audio: { src: 'https://example.com/audio.mp3' },
      video: { src: 'https://example.com/video.mp4' },
      cover: { src: 'https://example.com/cover.jpg' },
    };

    const result = detector.detectType(request);

    expect(result).toBe(PostType.AUDIO);
  });

  it('should respect priority: video over cover', () => {
    const request: PostRequest = {
      ...baseRequest,
      type: PostType.AUTO,
      video: { src: 'https://example.com/video.mp4' },
      cover: { src: 'https://example.com/cover.jpg' },
    };

    const result = detector.detectType(request);

    expect(result).toBe(PostType.VIDEO);
  });

  it('should detect POST when type is undefined and no media fields', () => {
    const request: PostRequest = {
      ...baseRequest,
      type: undefined,
    };

    const result = detector.detectType(request);

    expect(result).toBe(PostType.POST);
  });

  it('should handle MediaInput objects for detection', () => {
    const request: PostRequest = {
      ...baseRequest,
      type: PostType.AUTO,
      cover: { src: 'https://example.com/image.jpg', hasSpoiler: true },
    };

    const result = detector.detectType(request);

    expect(result).toBe(PostType.IMAGE);
  });

  it('should handle MediaInput with fileId for detection', () => {
    const request: PostRequest = {
      ...baseRequest,
      type: PostType.AUTO,
      video: { src: 'AgACAgIAAxkBAAIC...' },
    };

    const result = detector.detectType(request);

    expect(result).toBe(PostType.VIDEO);
  });

  it('should ignore empty media array', () => {
    const request: PostRequest = {
      ...baseRequest,
      type: PostType.AUTO,
      media: [],
      cover: { src: 'https://example.com/image.jpg' },
    };

    const result = detector.detectType(request);

    expect(result).toBe(PostType.IMAGE);
  });
});
