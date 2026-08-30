import { describe, expect, it } from 'vitest';
import { PostType } from '../src/types/post-type.js';
import { adaptRequest, previewFromCapabilities } from '../src/validation/capability-preview.js';
import type { PlatformCapabilities } from '../src/platforms/capabilities.js';
import type { PostRequest } from '../src/types/post-request.js';

const capabilities: PlatformCapabilities = {
  name: 'adapting-network',
  displayName: 'Adapting',
  postTypes: { [PostType.IMAGE]: { requiredFields: ['media'] } },
  maxBodyLength: 20,
  supportedBodyFormats: ['text', 'md'],
  targetBodyFormat: 'html',
  defaultVisibility: 'public',
  ignoredFields: ['tags'],
  media: {
    image: {
      acceptedSources: ['url'],
      transport: 'pull',
      requiresPubliclyFetchableUrl: true,
      urlMustRemainAvailableForSecs: 900,
    },
  },
};

const request: PostRequest = {
  platform: 'adapting-network',
  target: 42,
  type: PostType.IMAGE,
  body: '**bold** and a very long tail that will not fit',
  bodyFormat: 'md',
  tags: ['ignored'],
  media: [{ type: 'image', altText: 'a cat', source: { kind: 'url', url: 'https://cdn/a.jpg' } }],
};

describe('adaptRequest', () => {
  it('reports the request as the platform will receive it', () => {
    const adapted = adaptRequest(request, capabilities);

    expect(adapted.type).toBe(PostType.IMAGE);
    expect(adapted.target).toEqual({ id: '42' });
    expect(adapted.bodyFormat).toBe('html');
    expect(adapted.body).toContain('<b>bold</b>');
    expect(adapted.visibility).toBe('public');
    expect(adapted.droppedFields).toEqual(['tags']);
    expect(adapted.request.tags).toBeUndefined();
    expect(adapted.media).toEqual([
      { index: 0, kind: 'image', sourceKind: 'url', altText: 'a cat' },
    ]);
  });

  it('is a pure function of request and capabilities', () => {
    expect(adaptRequest(request, capabilities)).toEqual(adaptRequest(request, capabilities));
  });

  it('leaves the caller’s request untouched', () => {
    const original = structuredClone({ ...request, media: undefined });
    adaptRequest(request, capabilities);
    expect({ ...request, media: undefined }).toEqual(original);
  });
});

describe('preview', () => {
  it('carries the adapted request and the media URL lifetime the host must honour', () => {
    const result = previewFromCapabilities(request, capabilities);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.adaptedRequest?.type).toBe(PostType.IMAGE);
      expect(result.data.requiredMediaUrlLifetimeSecs).toBe(900);
      expect(result.data.truncated).toBe(true);
    }
  });

  it('reports no URL lifetime when nothing is fetched from a URL', () => {
    const result = previewFromCapabilities(
      {
        ...request,
        media: [{ type: 'image', source: { kind: 'platformRef', ref: 'file-1' } }],
      },
      capabilities,
    );

    expect(result.success && result.data.requiredMediaUrlLifetimeSecs).toBeUndefined();
  });
});
