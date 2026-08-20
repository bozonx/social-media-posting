import { describe, expect, it } from 'vitest';
import { validateAgainstCapabilities } from '../src/validation/capability-validator.js';
import { previewFromCapabilities } from '../src/validation/capability-preview.js';
import { PostType } from '../src/types/post-type.js';
import type { PlatformCapabilities } from '../src/platforms/capabilities.js';
import type { PostRequest } from '../src/types/post-request.js';

const capabilities: PlatformCapabilities = {
  name: 'demo',
  displayName: 'Demo',
  postTypes: {
    [PostType.POST]: {
      requiredFields: ['body'],
      forbiddenFields: ['media'],
    },
    [PostType.IMAGE]: {
      requiredFields: ['media'],
      minMediaCount: 1,
      maxMediaCount: 1,
    },
    [PostType.ALBUM]: {
      requiredFields: ['media'],
      minMediaCount: 2,
      maxMediaCount: 4,
    },
  },
  maxBodyLength: 100,
  supportedBodyFormats: ['text', 'html'],
  targetBodyFormat: 'text',
  supportsNativeScheduling: false,
  supportsDraft: false,
  sensitive: {
    supportedValues: [false],
  },
  ignoredFields: ['title', 'tags'],
};

const check = (request: Partial<PostRequest>) =>
  validateAgainstCapabilities({ platform: 'demo', ...request } as PostRequest, capabilities);

describe('validateAgainstCapabilities', () => {
  describe('post types', () => {
    it('detects the type from the media a request carries', () => {
      expect(
        check({ media: [{ source: { kind: 'url', url: 'https://a/b.jpg' } }] }).detectedType,
      ).toBe(PostType.IMAGE);
      expect(check({ body: 'hi' }).detectedType).toBe(PostType.POST);
    });

    it('rejects a type the platform does not support', () => {
      const result = check({ body: 'hi', type: PostType.STORY });

      expect(
        result.issues.some(i => i.message.includes("Post type 'story' is not supported")),
      ).toBe(true);
    });

    it('honours a platform-specific detector', () => {
      const result = validateAgainstCapabilities(
        { platform: 'demo', body: 'hi' } as PostRequest,
        capabilities,
        { detectType: () => PostType.IMAGE },
      );

      expect(result.detectedType).toBe(PostType.IMAGE);
      expect(result.issues.some(i => i.field === 'media')).toBe(true);
    });
  });

  describe('required and forbidden fields', () => {
    it('reports a missing required field', () => {
      expect(check({ type: PostType.IMAGE, body: 'x' }).issues.some(i => i.field === 'media')).toBe(
        true,
      );
    });

    it('reports media on a text-only type', () => {
      const result = check({
        body: 'hi',
        type: PostType.POST,
        media: [{ source: { kind: 'url', url: 'https://a/b.jpg' } }],
      });
      expect(result.issues.some(i => i.field === 'media')).toBe(true);
    });
  });

  describe('media counts', () => {
    it('rejects an album below the minimum', () => {
      const result = check({
        type: PostType.ALBUM,
        media: [{ source: { kind: 'url', url: 'https://a/1.jpg' } }],
      });

      expect(result.issues.some(i => i.message.includes('needs at least 2 media item(s)'))).toBe(
        true,
      );
    });

    it('rejects an album above the maximum', () => {
      const media = Array.from({ length: 5 }, (_, i) => ({
        source: { kind: 'url' as const, url: `https://a/${i}.jpg` },
      }));
      const result = check({ type: PostType.ALBUM, media });

      expect(result.issues.some(i => i.message.includes('accepts at most 4 media item(s)'))).toBe(
        true,
      );
    });
  });

  describe('media metadata constraints', () => {
    const constrained: PlatformCapabilities = {
      ...capabilities,
      media: {
        video: {
          acceptedSources: ['url'],
          minDurationSecs: 5,
          maxDurationSecs: 60,
          minAspectRatio: 0.5,
          maxAspectRatio: 2,
        },
      },
    };

    it('enforces declared duration and aspect-ratio limits (maximum exceeded)', () => {
      const result = validateAgainstCapabilities(
        {
          platform: 'demo',
          type: PostType.IMAGE,
          media: [
            {
              source: { kind: 'url', url: 'https://a/video.mp4' },
              type: 'video',
              durationSecs: 61,
              width: 300,
              height: 100,
            },
          ],
        },
        constrained,
      );

      expect(result.issues.some(i => i.message.includes('duration 61s exceeds'))).toBe(true);
      expect(result.issues.some(i => i.message.includes('aspect ratio 3 exceeds'))).toBe(true);
    });

    it('enforces declared duration and aspect-ratio limits (below minimum)', () => {
      const result = validateAgainstCapabilities(
        {
          platform: 'demo',
          type: PostType.IMAGE,
          media: [
            {
              source: { kind: 'url', url: 'https://a/video.mp4' },
              type: 'video',
              durationSecs: 2,
              width: 100,
              height: 300,
            },
          ],
        },
        constrained,
      );

      expect(result.issues.some(i => i.message.includes('duration 2s is below'))).toBe(true);
      expect(result.issues.some(i => i.message.includes('below the 0.5 minimum'))).toBe(true);
    });
  });

  describe('body rules', () => {
    it('rejects a body over the platform limit', () => {
      expect(
        check({ body: 'a'.repeat(101) }).issues.some(i =>
          i.message.includes('exceeds the 100 characters'),
        ),
      ).toBe(true);
    });

    it('rejects an unsupported body format', () => {
      expect(
        check({ body: 'hi', bodyFormat: 'md' }).issues.some(i =>
          i.message.includes("Body format 'md' is not supported"),
        ),
      ).toBe(true);
    });

    it('counts URLs the way the platform counts them', () => {
      const weighted: PlatformCapabilities = {
        ...capabilities,
        maxBodyLength: 30,
        bodyLengthRule: { urlWeight: 23 },
      };
      const body = `see https://example.com/${'x'.repeat(200)}`;

      const result = validateAgainstCapabilities(
        { platform: 'demo', body } as PostRequest,
        weighted,
      );

      expect(result.issues).toEqual([]);
    });
  });

  describe('fields that would be dropped', () => {
    it('warns about declared ignored fields instead of dropping them silently', () => {
      const result = check({ body: 'hi', title: 'T', tags: ['a'] });

      expect(
        result.warnings.some(w => w.message.includes('title, tags are not used by Demo')),
      ).toBe(true);
      expect(result.ignoredFields).toEqual(expect.arrayContaining(['title', 'tags']));
    });
  });

  describe('features the platform lacks', () => {
    it('refuses scheduledAt rather than ignoring it', () => {
      expect(
        check({ body: 'hi', scheduledAt: '2026-01-01T00:00:00Z' }).issues.some(i =>
          i.message.includes('cannot schedule posts'),
        ),
      ).toBe(true);
    });

    it('refuses a draft rather than publishing it', () => {
      expect(
        check({ body: 'hi', mode: 'draft' }).issues.some(i => i.message.includes('has no drafts')),
      ).toBe(true);
    });

    it('accepts mode publish on a platform without drafts', () => {
      expect(check({ body: 'hi', mode: 'publish' }).issues).toEqual([]);
    });

    it('refuses a sensitive flag the platform cannot render', () => {
      const result = check({
        type: PostType.IMAGE,
        media: [{ source: { kind: 'url', url: 'https://a/b.jpg' } }],
        sensitive: true,
      });

      expect(result.issues.some(i => i.field === 'sensitive')).toBe(true);
    });
  });

  describe('platform hooks', () => {
    it('adds issues from validateExtra', () => {
      const result = validateAgainstCapabilities(
        { platform: 'demo', body: 'hi' } as PostRequest,
        capabilities,
        {
          validateExtra: () => [
            { code: 'TARGET_REQUIRED', field: 'target', message: 'needs a target channel' },
          ],
        },
      );

      expect(result.issues.some(i => i.message === 'needs a target channel')).toBe(true);
    });
  });
});

describe('previewFromCapabilities', () => {
  it('returns the detected type and converted body when the request is valid', () => {
    const result = previewFromCapabilities(
      { platform: 'demo', body: '<b>hi</b>', bodyFormat: 'html' } as PostRequest,
      capabilities,
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.valid).toBe(true);
      expect(result.data.detectedType).toBe(PostType.POST);
      expect(result.data.targetFormat).toBe('text');
      expect(result.data.convertedBody).toBe('hi');
    }
  });

  it('returns valid: false with issues when request is invalid', () => {
    const result = previewFromCapabilities(
      { platform: 'demo', type: PostType.IMAGE } as PostRequest,
      capabilities,
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.valid).toBe(false);
      expect(result.data.issues.some(i => i.field === 'media')).toBe(true);
    }
  });

  it('shortens a body that would otherwise be refused', () => {
    const shortLimit: PlatformCapabilities = { ...capabilities, maxBodyLength: 20 };
    const result = previewFromCapabilities(
      { platform: 'demo', body: 'a'.repeat(15) } as PostRequest,
      shortLimit,
    );

    expect(result.success).toBe(true);
  });
});
