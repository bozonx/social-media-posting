import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { PostType } from '@bozonx/social-posting';
import type { MediaInput, PostRequest } from '@bozonx/social-posting';
import type { PostService, PreviewService } from '@bozonx/social-posting/platform';
import { postRoutes, streamPostRoutes } from '../../src/routes/post.routes.js';
import { errorHandler } from '../../src/middleware/errors.js';

const silentLogger = { debug: () => {}, log: () => {}, warn: () => {}, error: () => {} };

function bytesToBase64(text: string): string {
  return btoa(text);
}

function services() {
  const publish = vi.fn().mockResolvedValue({
    success: true,
    data: { status: 'published', postId: '1', platform: 'telegram', type: PostType.VIDEO },
  });
  return {
    publish,
    deps: {
      postService: { publish } as unknown as PostService,
      previewService: { preview: vi.fn() } as unknown as PreviewService,
      allowInlineAuth: false,
      includeRawResponses: false,
    },
  };
}

function appWith(deps: ReturnType<typeof services>['deps'], routes = streamPostRoutes) {
  const app = new Hono();
  app.onError(errorHandler(silentLogger));
  app.route('/', routes(deps));
  return app;
}

describe('POST /post/stream', () => {
  it('hands the request body to the platform as a stream, not as bytes in memory', async () => {
    const { publish, deps } = services();
    const app = appWith(deps);

    const meta = {
      platform: 'telegram',
      account: 'main',
      type: PostType.VIDEO,
      body: 'a clip',
      mediaMeta: { type: 'video', fileName: 'clip.mp4', mimeType: 'video/mp4', sizeBytes: 9 },
    };

    const response = await app.request('/post/stream', {
      method: 'POST',
      headers: {
        'content-type': 'application/octet-stream',
        'x-post-request': bytesToBase64(JSON.stringify(meta)),
      },
      body: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]),
      // Node's fetch requires this for a streamed body.
      duplex: 'half',
    } as RequestInit);

    expect(response.status).toBe(200);
    const request = publish.mock.calls[0]?.[0] as PostRequest;
    const media = request.media?.[0] as MediaInput;
    expect(media.source.kind).toBe('stream');
    expect(media.type).toBe('video');
    expect(media.fileName).toBe('clip.mp4');

    if (media.source.kind === 'stream') {
      const stream = await media.source.open();
      expect(stream).toBeInstanceOf(ReadableStream);
      // One pass over one request body: there is nothing here to rewind.
      await expect(media.source.open()).rejects.toThrow(/read once/);
    }
  });

  it('refuses a request with no metadata header', async () => {
    const { deps } = services();
    const response = await appWith(deps).request('/post/stream', {
      method: 'POST',
      body: new Uint8Array([1]),
      duplex: 'half',
    } as RequestInit);

    expect(response.status).toBe(400);
  });
});

describe('POST /post', () => {
  it('refuses video bytes in JSON and points at the streaming endpoint', async () => {
    const { publish, deps } = services();
    const app = appWith(deps, postRoutes);

    const response = await app.request('/post', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        platform: 'telegram',
        account: 'main',
        media: [{ type: 'video', source: { kind: 'base64', base64: 'AAAA' } }],
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.text()).toMatch(/post\/stream/);
    expect(publish).not.toHaveBeenCalled();
  });
});
