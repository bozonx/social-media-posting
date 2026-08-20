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
  return validatePostRequest({ ...base, ...overrides } as PostRequest).map(i => i.message);
}

describe('validatePostRequest', () => {
  describe('content presence', () => {
    it('accepts a body-only post', () => {
      expect(validatePostRequest(base)).toEqual([]);
    });

    it('accepts a post carrying only media', () => {
      expect(
        errorsFor({
          body: undefined,
          media: [{ source: { kind: 'url', url: 'https://example.com/a.jpg' } }],
        }),
      ).toEqual([]);
    });

    it('accepts a post carrying only poll', () => {
      expect(
        errorsFor({
          body: undefined,
          poll: { options: ['Option 1', 'Option 2'] },
        }),
      ).toEqual([]);
    });

    it('accepts a post carrying only repostOf', () => {
      expect(
        errorsFor({
          body: undefined,
          repostOf: { id: '123' },
        }),
      ).toEqual([]);
    });

    it('accepts a post carrying only location', () => {
      expect(
        errorsFor({
          body: undefined,
          location: { latitude: 10, longitude: 20 },
        }),
      ).toEqual([]);
    });

    it('rejects a post with neither body nor media nor special content', () => {
      expect(errorsFor({ body: undefined }).join(' ')).toContain('Post must have either body text');
    });

    it('rejects a whitespace-only body with no media', () => {
      expect(errorsFor({ body: '   ' }).join(' ')).toContain('Post must have either body text');
    });

    it('rejects an empty media array with no body', () => {
      expect(errorsFor({ body: undefined, media: [] }).join(' ')).toContain(
        'Post must have either body text',
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
  });

  describe('media inputs', () => {
    it('rejects a media input without source', () => {
      expect(errorsFor({ media: [{} as never] }).join(' ')).toContain("Field 'media[0].source'");
    });

    it('rejects an over-long url in source', () => {
      expect(
        errorsFor({ media: [{ source: { kind: 'url', url: 'x'.repeat(2049) } }] }).join(' '),
      ).toContain("Field 'media[0].source.url' must not exceed 2048 characters");
    });

    it('rejects a non-boolean sensitive', () => {
      expect(
        errorsFor({
          media: [
            {
              source: { kind: 'url', url: 'https://a/b.jpg' },
              sensitive: 'yes' as never,
            },
          ],
        }).join(' '),
      ).toContain("Field 'media[0].sensitive'");
    });

    it('rejects an unknown media type', () => {
      expect(
        errorsFor({
          media: [
            {
              source: { kind: 'url', url: 'https://a/b.jpg' },
              type: 'gif' as never,
            },
          ],
        }).join(' '),
      ).toContain("Field 'media[0].type'");
    });

    it('validates media dimensions and duration metadata', () => {
      expect(
        errorsFor({
          media: [
            {
              source: { kind: 'url', url: 'https://a/b.jpg' },
              durationSecs: -1,
              width: 100,
            } as never,
          ],
        }).join(' '),
      ).toContain('durationSecs');
      expect(
        errorsFor({
          media: [
            {
              source: { kind: 'url', url: 'https://a/b.jpg' },
              width: 100,
            } as never,
          ],
        }).join(' '),
      ).toContain('must be provided together');
      expect(
        errorsFor({
          media: [
            {
              source: { kind: 'url', url: 'https://a/b.jpg' },
              width: 100,
              height: 50,
            },
          ],
        }),
      ).toEqual([]);
    });

    it('reports the index of a bad media item', () => {
      expect(
        errorsFor({
          media: [
            { source: { kind: 'url', url: 'https://a/b.jpg' } },
            { source: { kind: 'url', url: '' } },
          ],
        }).join(' '),
      ).toContain("Field 'media[1].source.url'");
    });

    it('rejects a non-array media field', () => {
      expect(errorsFor({ media: 'nope' as never }).join(' ')).toContain(
        "Field 'media' must be an array",
      );
    });
  });

  describe('scalar fields', () => {
    it('accepts every standard post type', () => {
      for (const type of Object.values(PostType)) {
        expect(
          errorsFor({
            type,
            media: [{ source: { kind: 'url', url: 'https://a/b.jpg' } }],
          }),
        ).toEqual([]);
      }
    });

    it.each([
      ['a non-empty string target', '@channel', true],
      ['an integer target', -100123456789, true],
      ['an empty target', '   ', false],
      ['a fractional target', 1.5, false],
      ['a boolean target', true, false],
    ])('handles %s', (_name, target, valid) => {
      const errors = errorsFor({ target: target as never });
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
