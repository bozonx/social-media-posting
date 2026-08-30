import { afterEach, describe, expect, it, vi } from 'vitest';
import { MediaFetcher } from '../src/media/media-fetcher.js';
import { requiresByteUpload, toMediaSource } from '../src/media/media-source.js';
import { mediaKindOf, sniffMimeType } from '../src/media/mime-sniffer.js';
import { ValidationError } from '../src/errors/posting-error.js';
import { PlatformError } from '../src/errors/platform-error.js';
import { PostType } from '../src/types/post-type.js';
import type { PlatformCapabilities } from '../src/platforms/capabilities.js';

const originalFetch = globalThis.fetch;

const capabilities: PlatformCapabilities = {
  name: 'demo',
  postTypes: {
    [PostType.IMAGE]: {
      requiredFields: ['media'],
    },
  },
  media: {
    image: {
      acceptedSources: ['url', 'bytes'],
      transport: 'both',
      mimeTypes: ['image/jpeg', 'image/png'],
      maxBytes: 1024,
    },
  },
};

const JPEG_HEADER = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const PNG_HEADER = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function bytesStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

async function drain(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('sniffMimeType', () => {
  it.each([
    ['image/jpeg', JPEG_HEADER],
    ['image/png', PNG_HEADER],
    ['image/gif', new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])],
    ['application/pdf', new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])],
    [
      'video/mp4',
      new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32]),
    ],
  ])('recognises %s', (expected, bytes) => {
    expect(sniffMimeType(bytes)).toBe(expected);
  });

  it('returns undefined for something it does not know', () => {
    expect(sniffMimeType(new Uint8Array([1, 2, 3, 4]))).toBeUndefined();
  });

  it('maps a MIME type onto the kind a descriptor is keyed by', () => {
    expect(mediaKindOf('image/png')).toBe('image');
    expect(mediaKindOf('video/mp4')).toBe('video');
    expect(mediaKindOf('audio/mpeg')).toBe('audio');
    expect(mediaKindOf(undefined)).toBe('document');
  });
});

describe('requiresByteUpload', () => {
  it('is false when the platform fetches URLs itself', () => {
    const source = toMediaSource({ source: { kind: 'url', url: 'https://cdn.example/a.jpg' } });

    expect(
      requiresByteUpload(source, {
        ...capabilities,
        media: { image: { acceptedSources: ['url', 'bytes'], transport: 'both' } },
      }),
    ).toBe(false);
  });

  it('is true when the platform cannot fetch for itself', () => {
    const source = toMediaSource({ source: { kind: 'url', url: 'https://cdn.example/a.jpg' } });

    expect(
      requiresByteUpload(source, {
        ...capabilities,
        media: { image: { acceptedSources: ['bytes'], transport: 'push' } },
      }),
    ).toBe(true);
  });

  it('is false for media the platform already stores', () => {
    const source = toMediaSource({ source: { kind: 'platformRef', ref: 'AgACAgIAAxkBAAIC' } });

    expect(requiresByteUpload(source, capabilities)).toBe(false);
  });
});

describe('MediaFetcher', () => {
  it('reads type and size from the origin without downloading', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 200,
        headers: { 'content-type': 'image/jpeg; charset=binary', 'content-length': '512' },
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const metadata = await new MediaFetcher().probe({
      kind: 'url',
      url: 'https://cdn.example/a.jpg',
    });

    expect(metadata).toMatchObject({ mimeType: 'image/jpeg', sizeBytes: 512, kind: 'image' });
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'HEAD' });
  });

  it('probes non-URL sources directly without network calls', async () => {
    const fetcher = new MediaFetcher();

    const bytesMeta = await fetcher.probe({
      kind: 'bytes',
      bytes: new Uint8Array(256),
      mimeType: 'image/png',
      fileName: 'test.png',
    });
    expect(bytesMeta).toEqual({
      mimeType: 'image/png',
      sizeBytes: 256,
      fileName: 'test.png',
      kind: 'image',
    });

    const blobMeta = await fetcher.probe({
      kind: 'blob',
      blob: new Blob(['data'], { type: 'image/jpeg' }),
      fileName: 'photo.jpg',
    });
    expect(blobMeta).toEqual({
      mimeType: 'image/jpeg',
      sizeBytes: 4,
      fileName: 'photo.jpg',
      kind: 'image',
    });

    const streamMeta = await fetcher.probe({
      kind: 'stream',
      open: async () => new ReadableStream(),
      sizeBytes: 500,
      mimeType: 'video/mp4',
    });
    expect(streamMeta).toEqual({
      mimeType: 'video/mp4',
      sizeBytes: 500,
      fileName: undefined,
      kind: 'video',
    });
  });

  it('refuses to probe platform references', async () => {
    await expect(new MediaFetcher().probe({ kind: 'platformRef', ref: 'ref-123' })).rejects.toThrow(
      ValidationError,
    );
  });

  it('refuses an oversized file before paying for the download', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 200,
        headers: { 'content-type': 'image/jpeg', 'content-length': '99999' },
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      new MediaFetcher().open({ kind: 'url', url: 'https://cdn.example/big.jpg' }, capabilities),
    ).rejects.toThrow(ValidationError);
    // Only the HEAD went out; the body was never requested.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refuses a media type the platform does not accept', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 200,
        headers: { 'content-type': 'image/tiff', 'content-length': '10' },
      }),
    ) as unknown as typeof fetch;

    await expect(
      new MediaFetcher().open({ kind: 'url', url: 'https://cdn.example/a.tiff' }, capabilities),
    ).rejects.toThrow(/not accepted/);
  });

  it('identifies the type from the bytes when the origin will not say', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 405 }))
      .mockResolvedValueOnce(
        new Response(bytesStream(JPEG_HEADER), {
          status: 200,
          headers: { 'content-type': 'application/octet-stream' },
        }),
      ) as unknown as typeof fetch;

    // The URL claims .png; the bytes say JPEG, and the bytes win.
    const opened = await new MediaFetcher().open(
      { kind: 'url', url: 'https://cdn.example/mislabelled.png' },
      capabilities,
    );

    expect(opened.mimeType).toBe('image/jpeg');
    expect(await drain(opened.stream)).toEqual(JPEG_HEADER);
  });

  it('handles empty stream gracefully during mime sniffing', async () => {
    const emptyStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      },
    });

    const opened = await new MediaFetcher().open({
      kind: 'stream',
      open: async () => emptyStream,
      mimeType: 'image/jpeg',
    });

    expect(opened.mimeType).toBe('image/jpeg');
    expect(await drain(opened.stream)).toEqual(new Uint8Array([]));
  });

  it('fails an oversized download while it streams, when the origin understated it', async () => {
    const oversized = new Uint8Array(4096);
    oversized.set(JPEG_HEADER, 0);
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 200,
          headers: { 'content-type': 'image/jpeg', 'content-length': '10' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(bytesStream(oversized), { status: 200 }),
      ) as unknown as typeof fetch;

    const opened = await new MediaFetcher().open(
      { kind: 'url', url: 'https://cdn.example/liar.jpg' },
      capabilities,
    );

    await expect(drain(opened.stream)).rejects.toThrow(/exceeds the 1024 byte limit/);
  });

  it('opens in-memory bytes without touching the network', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const opened = await new MediaFetcher().open(
      { kind: 'bytes', bytes: PNG_HEADER },
      capabilities,
    );

    expect(opened.mimeType).toBe('image/png');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('opens Blob sources', async () => {
    const blob = new Blob([PNG_HEADER], { type: 'image/png' });
    const opened = await new MediaFetcher().open({ kind: 'blob', blob }, capabilities);

    expect(opened.mimeType).toBe('image/png');
    expect(await drain(opened.stream)).toEqual(PNG_HEADER);
  });

  it('opens Stream sources', async () => {
    const opened = await new MediaFetcher().open(
      {
        kind: 'stream',
        open: async () => bytesStream(PNG_HEADER),
        mimeType: 'image/png',
      },
      capabilities,
    );

    expect(opened.mimeType).toBe('image/png');
    expect(await drain(opened.stream)).toEqual(PNG_HEADER);
  });

  it('reopens a source at an offset, for an upload that resumes', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

    const stream = await new MediaFetcher().openAt({ kind: 'bytes', bytes }, 5);

    expect(await drain(stream)).toEqual(new Uint8Array([6, 7, 8]));
  });

  it('reopens a blob source at an offset', async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])]);
    const stream = await new MediaFetcher().openAt({ kind: 'blob', blob }, 4);

    expect(await drain(stream)).toEqual(new Uint8Array([5, 6, 7, 8]));
  });

  it('asks the origin for a byte range when resuming a URL source', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(bytesStream(JPEG_HEADER), { status: 206 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await new MediaFetcher().openAt({ kind: 'url', url: 'https://cdn.example/a.jpg' }, 1024);

    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({ range: 'bytes=1024-' });
  });

  it('refuses to fetch media the platform already stores', async () => {
    await expect(new MediaFetcher().open({ kind: 'platformRef', ref: 'file-123' })).rejects.toThrow(
      ValidationError,
    );
  });

  it('refuses to openAt media the platform already stores', async () => {
    await expect(
      new MediaFetcher().openAt({ kind: 'platformRef', ref: 'file-123' }, 10),
    ).rejects.toThrow(ValidationError);
  });

  describe('validateUrl hook and redirect limits', () => {
    it('runs custom validateUrl validator against request URLs', async () => {
      const validateUrl = vi.fn((url: URL) => {
        if (url.hostname === 'internal.corp') {
          throw new ValidationError('Internal URLs are not allowed');
        }
      });
      const fetcher = new MediaFetcher({ validateUrl });

      await expect(
        fetcher.probe({ kind: 'url', url: 'https://internal.corp/secret.png' }),
      ).rejects.toThrow('Internal URLs are not allowed');
      expect(validateUrl).toHaveBeenCalledWith(new URL('https://internal.corp/secret.png'));
    });

    it('follows redirects and validates every hop', async () => {
      const validateUrl = vi.fn();
      const fetcher = new MediaFetcher({ validateUrl });

      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(null, {
            status: 302,
            headers: { location: 'https://cdn.example/final.jpg' },
          }),
        )
        .mockResolvedValueOnce(
          new Response(null, {
            status: 200,
            headers: { 'content-type': 'image/jpeg', 'content-length': '200' },
          }),
        ) as unknown as typeof fetch;

      const metadata = await fetcher.probe({ kind: 'url', url: 'https://origin.example/init.jpg' });

      expect(metadata.sizeBytes).toBe(200);
      expect(validateUrl).toHaveBeenCalledWith(new URL('https://origin.example/init.jpg'));
      expect(validateUrl).toHaveBeenCalledWith(new URL('https://cdn.example/final.jpg'));
    });

    it('throws ValidationError when exceeding maximum of 5 redirects', async () => {
      const fetcher = new MediaFetcher();

      globalThis.fetch = vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response(null, {
            status: 302,
            headers: { location: 'https://cdn.example/redirect' },
          }),
        ),
      ) as unknown as typeof fetch;

      await expect(
        fetcher.probe({ kind: 'url', url: 'https://cdn.example/redirect' }),
      ).rejects.toThrow('Media URL exceeded the maximum of 5 redirects');
    });

    it('throws PlatformError when remote fetch answers with error status', async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValue(new Response('not found', { status: 404 })) as unknown as typeof fetch;

      await expect(
        new MediaFetcher().open({ kind: 'url', url: 'https://cdn.example/notfound.jpg' }),
      ).rejects.toThrow(PlatformError);
    });
  });
});
