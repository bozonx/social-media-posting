import { describe, expect, it } from 'vitest';
import {
  MAX_BODY_LIMIT,
  assertValidPostRequest,
  validatePostRequest,
} from '../src/validation/validate-post-request.js';
import { ValidationError } from '../src/errors/posting-error.js';
import { PostType } from '../src/types/post-type.js';
import type { PostRequest } from '../src/types/post-request.js';

const base: PostRequest = { platform: 'telegram', body: 'Hello' };

function errorsFor(overrides: Partial<PostRequest>): string[] {
  return validatePostRequest({ ...base, ...overrides } as PostRequest);
}

describe('validatePostRequest', () => {
  describe('content presence', () => {
    it('accepts a body-only post', () => {
      expect(validatePostRequest(base)).toEqual([]);
    });

    it.each([
      ['cover', { cover: { src: 'https://example.com/a.jpg' } }],
      ['video', { video: { src: 'https://example.com/a.mp4' } }],
      ['audio', { audio: { src: 'https://example.com/a.mp3' } }],
      ['document', { document: { src: 'https://example.com/a.pdf' } }],
      ['media', { media: [{ src: 'https://example.com/a.jpg' }] }],
    ])('accepts a post carrying only %s', (_name, overrides) => {
      expect(errorsFor({ body: undefined, ...(overrides as Partial<PostRequest>) })).toEqual([]);
    });

    it('rejects a post with neither body nor media', () => {
      expect(errorsFor({ body: undefined }).join(' ')).toContain('must have either body text');
    });

    it('rejects a whitespace-only body with no media', () => {
      expect(errorsFor({ body: '   ' }).join(' ')).toContain('must have either body text');
    });

    it('rejects an empty media array with no body', () => {
      expect(errorsFor({ body: undefined, media: [] }).join(' ')).toContain(
        'must have either body text',
      );
    });
  });

  describe('platform', () => {
    it('rejects a missing platform', () => {
      expect(errorsFor({ platform: undefined as never }).join(' ')).toContain(
        "Field 'platform' is required",
      );
    });

    it('rejects a blank platform', () => {
      expect(errorsFor({ platform: '  ' }).join(' ')).toContain("Field 'platform' is required");
    });
  });

  describe('body length', () => {
    it('accepts a body at the absolute limit', () => {
      expect(errorsFor({ body: 'a'.repeat(MAX_BODY_LIMIT) })).toEqual([]);
    });

    it('rejects a body over the absolute limit', () => {
      expect(errorsFor({ body: 'a'.repeat(MAX_BODY_LIMIT + 1) }).join(' ')).toContain(
        'Body length must not exceed',
      );
    });

    it('honours a lower maxBody override', () => {
      expect(errorsFor({ body: 'abcdef', maxBody: 5 }).join(' ')).toContain(
        'Body length must not exceed 5',
      );
    });

    it('rejects a maxBody above the absolute limit', () => {
      expect(errorsFor({ maxBody: MAX_BODY_LIMIT + 1 }).join(' ')).toContain("Field 'maxBody'");
    });
  });

  describe('media inputs', () => {
    it('rejects a media input without src', () => {
      expect(errorsFor({ cover: {} as never }).join(' ')).toContain("Field 'cover.src'");
    });

    it('rejects an over-long src', () => {
      expect(errorsFor({ cover: { src: 'x'.repeat(501) } }).join(' ')).toContain(
        "Field 'cover.src' must not exceed 500 characters",
      );
    });

    it('rejects a non-boolean hasSpoiler', () => {
      expect(
        errorsFor({ cover: { src: 'https://a/b.jpg', hasSpoiler: 'yes' as never } }).join(' '),
      ).toContain("Field 'cover.hasSpoiler'");
    });

    it('rejects an unknown media type', () => {
      expect(
        errorsFor({ cover: { src: 'https://a/b.jpg', type: 'gif' as never } }).join(' '),
      ).toContain("Field 'cover.type'");
    });

    it('validates media dimensions and duration metadata', () => {
      expect(
        errorsFor({
          cover: { src: 'https://a/b.jpg', durationSecs: -1, width: 100 } as never,
        }).join(' '),
      ).toContain('durationSecs');
      expect(
        errorsFor({ cover: { src: 'https://a/b.jpg', width: 100 } as never }).join(' '),
      ).toContain('must be provided together');
      expect(errorsFor({ cover: { src: 'https://a/b.jpg', width: 100, height: 50 } })).toEqual([]);
    });

    it('reports the index of a bad album item', () => {
      expect(
        errorsFor({
          media: [{ src: 'https://a/b.jpg' }, { src: '' }],
        }).join(' '),
      ).toContain("Field 'media[1].src'");
    });

    it('rejects a non-array media field', () => {
      expect(errorsFor({ media: 'nope' as never }).join(' ')).toContain(
        "Field 'media' must be an array",
      );
    });
  });

  describe('scalar fields', () => {
    it('rejects an unknown post type', () => {
      expect(errorsFor({ type: 'reel' as never }).join(' ')).toContain("Field 'type'");
    });

    it('accepts every known post type', () => {
      for (const type of Object.values(PostType)) {
        expect(errorsFor({ type, media: [{ src: 'https://a/b.jpg' }] })).toEqual([]);
      }
    });

    it.each([
      ['a non-empty string channelId', '@channel', true],
      ['an integer channelId', -100123456789, true],
      ['an empty channelId', '   ', false],
      ['a fractional channelId', 1.5, false],
      ['a boolean channelId', true, false],
    ])('handles %s', (_name, channelId, valid) => {
      const errors = errorsFor({ channelId: channelId as never });
      expect(errors.length === 0).toBe(valid);
    });

    it('rejects a non-object auth', () => {
      expect(errorsFor({ auth: 'token' as never }).join(' ')).toContain("Field 'auth'");
    });

    it('rejects too many tags', () => {
      expect(errorsFor({ tags: Array.from({ length: 201 }, () => 'tag') }).join(' ')).toContain(
        "Field 'tags' must not contain more than 200",
      );
    });

    it('rejects an over-long tag', () => {
      expect(errorsFor({ tags: ['x'.repeat(301)] }).join(' ')).toContain('Each tag must be');
    });

    it('rejects an unknown mode', () => {
      expect(errorsFor({ mode: 'schedule' as never }).join(' ')).toContain("Field 'mode'");
    });
  });

  describe('assertValidPostRequest', () => {
    it('passes a valid request through', () => {
      expect(() => assertValidPostRequest(base)).not.toThrow();
    });

    it('throws a ValidationError carrying every message', () => {
      let caught: unknown;
      try {
        assertValidPostRequest({ platform: '', tags: ['x'.repeat(301)] } as PostRequest);
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(ValidationError);
      expect((caught as ValidationError).errors.length).toBeGreaterThan(1);
    });
  });
});
