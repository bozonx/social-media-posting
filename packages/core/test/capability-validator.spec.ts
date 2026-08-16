import { describe, expect, it } from 'vitest';
import { validateAgainstCapabilities } from '../src/validation/capability-validator.js';
import { previewFromCapabilities } from '../src/validation/capability-preview.js';
import { PostType } from '../src/types/post-type.js';
import type { PlatformCapabilities } from '../src/platforms/capabilities.js';
import type { PostRequest } from '../src/types/post-request.js';

const capabilities: PlatformCapabilities = {
  name: 'demo',
  displayName: 'Demo',
  supportedTypes: [PostType.AUTO, PostType.POST, PostType.IMAGE, PostType.ALBUM],
  postTypes: {
    [PostType.POST]: {
      requiredFields: ['body'],
      forbiddenFields: ['cover', 'video', 'audio', 'document', 'media'],
    },
    [PostType.IMAGE]: { requiredFields: ['cover'] },
    [PostType.ALBUM]: { requiredFields: ['media'], minMediaCount: 2, maxMediaCount: 4 },
  },
  maxBodyLength: 100,
  supportedBodyFormats: ['text', 'html'],
  targetBodyFormat: 'text',
  supportsNativeScheduling: false,
  supportsDraft: false,
  supportsSpoiler: false,
  ignoredFields: ['title', 'tags'],
};

const check = (request: Partial<PostRequest>) =>
  validateAgainstCapabilities({ platform: 'demo', ...request } as PostRequest, capabilities);

describe('validateAgainstCapabilities', () => {
  describe('post types', () => {
    it('detects the type from the media a request carries', () => {
      expect(check({ cover: { src: 'https://a/b.jpg' } }).detectedType).toBe(PostType.IMAGE);
      expect(check({ body: 'hi' }).detectedType).toBe(PostType.POST);
    });

    it('rejects a type the platform does not support', () => {
      const result = check({ body: 'hi', type: PostType.STORY });

      expect(result.errors).toContain("Post type 'story' is not supported for Demo");
    });

    it('honours a platform-specific detector', () => {
      const result = validateAgainstCapabilities(
        { platform: 'demo', body: 'hi' } as PostRequest,
        capabilities,
        { detectType: () => PostType.IMAGE },
      );

      expect(result.detectedType).toBe(PostType.IMAGE);
      expect(result.errors).toContain("Field 'cover' is required for type 'image'");
    });
  });

  describe('required and forbidden fields', () => {
    it('reports a missing required field', () => {
      expect(check({ type: PostType.IMAGE, body: 'x' }).errors).toContain(
        "Field 'cover' is required for type 'image'",
      );
    });

    it('reports media on a text-only type', () => {
      expect(
        check({ body: 'hi', type: PostType.POST, cover: { src: 'https://a/b.jpg' } }).errors,
      ).toContain("For type 'post', media fields must not be provided");
    });
  });

  describe('media counts', () => {
    it('rejects an album below the minimum', () => {
      const result = check({ type: PostType.ALBUM, media: [{ src: 'https://a/1.jpg' }] });

      expect(result.errors.join(' ')).toContain('needs at least 2 media item(s), got 1');
    });

    it('rejects an album above the maximum', () => {
      const media = Array.from({ length: 5 }, (_, i) => ({ src: `https://a/${i}.jpg` }));
      const result = check({ type: PostType.ALBUM, media });

      expect(result.errors.join(' ')).toContain('accepts at most 4 media item(s), got 5');
    });
  });

  describe('media metadata constraints', () => {
    const constrained: PlatformCapabilities = {
      ...capabilities,
      media: {
        video: { minDurationSecs: 2, maxDurationSecs: 60, minAspectRatio: 0.5, maxAspectRatio: 2 },
      },
    };

    it('enforces declared duration and aspect-ratio limits', () => {
      const result = validateAgainstCapabilities(
        {
          platform: 'demo',
          type: PostType.IMAGE,
          cover: { src: 'https://a/cover.jpg' },
          video: { src: 'https://a/video.mp4', durationSecs: 61, width: 300, height: 100 },
        },
        constrained,
      );

      expect(result.errors.join(' ')).toContain('duration 61s exceeds');
      expect(result.errors.join(' ')).toContain('aspect ratio 3 exceeds');
    });
  });

  describe('body rules', () => {
    it('rejects a body over the platform limit', () => {
      expect(check({ body: 'a'.repeat(101) }).errors.join(' ')).toContain(
        'exceeds the 100 characters',
      );
    });

    it('honours a stricter per-request maxBody', () => {
      expect(check({ body: 'a'.repeat(50), maxBody: 10 }).errors.join(' ')).toContain(
        'exceeds the 10 characters',
      );
    });

    it('rejects an unsupported body format', () => {
      expect(check({ body: 'hi', bodyFormat: 'md' }).errors.join(' ')).toContain(
        "Body format 'md' is not supported",
      );
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

      // 4 characters of text plus a URL counted as 23, not its real length.
      expect(result.errors).toEqual([]);
    });
  });

  describe('fields that would be dropped', () => {
    it('warns about declared ignored fields instead of dropping them silently', () => {
      const result = check({ body: 'hi', title: 'T', tags: ['a'] });

      expect(result.warnings).toContain(
        'Fields title, tags are not used by Demo and will be ignored',
      );
      expect(result.ignoredFields).toEqual(expect.arrayContaining(['title', 'tags']));
    });

    it('warns about media the detected type will not use', () => {
      const result = check({
        type: PostType.IMAGE,
        cover: { src: 'https://a/b.jpg' },
        video: { src: 'https://a/b.mp4' },
      });

      expect(result.warnings).toContain("Fields video will be ignored for type 'image'");
    });
  });

  describe('features the platform lacks', () => {
    it('refuses scheduledAt rather than ignoring it', () => {
      expect(check({ body: 'hi', scheduledAt: '2026-01-01T00:00:00Z' }).errors.join(' ')).toContain(
        'cannot schedule posts',
      );
    });

    it('refuses a draft rather than publishing it', () => {
      expect(check({ body: 'hi', mode: 'draft' }).errors.join(' ')).toContain('has no drafts');
    });

    it('accepts mode publish on a platform without drafts', () => {
      expect(check({ body: 'hi', mode: 'publish' }).errors).toEqual([]);
    });

    it('refuses a spoiler the platform cannot render', () => {
      const result = check({
        type: PostType.IMAGE,
        cover: { src: 'https://a/b.jpg', hasSpoiler: true },
      });

      expect(result.errors.join(' ')).toContain('has no spoilers');
    });
  });

  describe('platform hooks', () => {
    it('adds errors from validateExtra', () => {
      const result = validateAgainstCapabilities(
        { platform: 'demo', body: 'hi' } as PostRequest,
        capabilities,
        { validateExtra: () => ['needs a target channel'] },
      );

      expect(result.errors).toContain('needs a target channel');
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
      expect(result.data.detectedType).toBe(PostType.POST);
      expect(result.data.targetFormat).toBe('text');
      expect(result.data.convertedBody).toBe('hi');
    }
  });

  it('returns the collected errors when it is not', () => {
    const result = previewFromCapabilities(
      { platform: 'demo', type: PostType.IMAGE } as PostRequest,
      capabilities,
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.data.errors).toContain("Field 'cover' is required for type 'image'");
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
