import { afterEach, describe, expect, it, vi } from 'vitest';
import { MediaFetcher } from '../src/media/media-fetcher.js';
import { requiresByteUpload, toMediaSource } from '../src/media/media-source.js';
import { mediaKindOf, sniffMimeType } from '../src/media/mime-sniffer.js';
import { ValidationError } from '../src/errors/posting-error.js';
import { PostType } from '../src/types/post-type.js';
import type { PlatformCapabilities } from '../src/platforms/capabilities.js';

const originalFetch = globalThis.fetch;

const capabilities: PlatformCapabilities = {
  name: 'demo',
  supportedTypes: [PostType.IMAGE],
  media: {
    image: { mimeTypes: ['image/jpeg', 'image/png'], maxBytes: 1024 },
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
    const source = toMediaSource({ src: 'https://cdn.example/a.jpg' });

    expect(requiresByteUpload(source, { ...capabilities, supportsUrlPassthrough: true })).toBe(
      false,
    );
  });

  it('is true when the platform cannot fetch for itself', () => {
    const source = toMediaSource({ src: 'https://cdn.example/a.jpg' });

    expect(requiresByteUpload(source, { ...capabilities, supportsUrlPassthrough: false })).toBe(
      true,
    );
  });

  it('is false for media the platform already stores', () => {
    const source = toMediaSource({ src: 'AgACAgIAAxkBAAIC' });

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
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'HEAD' });
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

  it('reopens a source at an offset, for an upload that resumes', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

    const stream = await new MediaFetcher().openAt({ kind: 'bytes', bytes }, 5);

    expect(await drain(stream)).toEqual(new Uint8Array([6, 7, 8]));
  });

  it('asks the origin for a byte range when resuming a URL source', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(bytesStream(JPEG_HEADER), { status: 206 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await new MediaFetcher().openAt({ kind: 'url', url: 'https://cdn.example/a.jpg' }, 1024);

    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({ range: 'bytes=1024-' });
  });

  it('refuses to fetch media the platform already stores', async () => {
    await expect(new MediaFetcher().open({ kind: 'platformRef', ref: 'file-123' })).rejects.toThrow(
      ValidationError,
    );
  });
});
