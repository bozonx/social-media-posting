import { MediaInputHelper } from './media-input.helper.js';
import { ValidationError } from '../errors/posting-error.js';
import type { MediaInput } from '../types/media-input.js';
import type { PlatformCapabilities } from '../platforms/capabilities.js';

/**
 * Where the bytes of one media item come from, at the library's internal
 * boundary.
 *
 * The public request shape stays a string `src`, which is all a caller needs.
 * Inside, a platform has to know whether it can hand the network a URL and let
 * it fetch, or whether it must move the bytes itself — and if so, whether they
 * are already in memory or have to be streamed.
 *
 * There is deliberately no Node `Readable` here. A `ReadableStream` is the web
 * standard and runs unchanged on Node, Workers, Deno and Bun.
 */
export type MediaSource =
  UrlMediaSource | BytesMediaSource | BlobMediaSource | StreamMediaSource | PlatformRefMediaSource;

/** A public URL the platform may fetch itself. */
export interface UrlMediaSource {
  kind: 'url';
  url: string;
  mimeType?: string;
  fileName?: string;
}

/** Bytes already in memory. Suitable only for small media. */
export interface BytesMediaSource {
  kind: 'bytes';
  bytes: Uint8Array;
  mimeType?: string;
  fileName?: string;
}

/** A `Blob` or `File`, which carries its own type and size. */
export interface BlobMediaSource {
  kind: 'blob';
  blob: Blob;
  fileName?: string;
}

/**
 * A factory that opens a fresh stream over the media.
 *
 * A factory rather than a stream, because a stream can only be read once: an
 * upload that has to resume from an offset must be able to open the source
 * again.
 */
export interface StreamMediaSource {
  kind: 'stream';
  open: (options?: {
    offsetBytes?: number;
    signal?: AbortSignal;
  }) => Promise<ReadableStream<Uint8Array>>;
  sizeBytes?: number;
  mimeType?: string;
  fileName?: string;
}

/** Media the platform already stores, identified by its own reference. */
export interface PlatformRefMediaSource {
  kind: 'platformRef';
  ref: string;
}

/**
 * Read a request's media field as a {@link MediaSource}.
 *
 * @param input - The media input from the request.
 * @returns A URL source, or a platform reference when `src` is not a URL.
 * @throws ValidationError if the input carries neither.
 */
export function toMediaSource(input: MediaInput): MediaSource {
  const url = MediaInputHelper.getUrl(input);
  if (url) {
    return { kind: 'url', url };
  }

  const ref = MediaInputHelper.getPlatformRef(input);
  if (ref) {
    return { kind: 'platformRef', ref };
  }

  throw new ValidationError('MediaInput must carry a URL or a platform reference');
}

/**
 * Whether this library has to move the bytes itself.
 *
 * This is the fast path that decides whether a network is viable on a
 * memory-limited runtime. Telegram, Meta's Graph API and TikTok's
 * `PULL_FROM_URL` all fetch media themselves from a public URL, so nothing
 * passes through this process at all — which is what makes a Workers
 * deployment real rather than decorative.
 *
 * @param source - Where the media comes from.
 * @param capabilities - What the platform accepts.
 * @returns True when the bytes must be uploaded by this process.
 */
export function requiresByteUpload(
  source: MediaSource,
  capabilities: PlatformCapabilities,
): boolean {
  if (source.kind === 'platformRef') {
    return false;
  }
  if (source.kind === 'url' && capabilities.supportsUrlPassthrough) {
    return false;
  }
  return true;
}

/** The declared size of a source, when it is known without reading it. */
export function knownSizeBytes(source: MediaSource): number | undefined {
  switch (source.kind) {
    case 'bytes':
      return source.bytes.byteLength;
    case 'blob':
      return source.blob.size;
    case 'stream':
      return source.sizeBytes;
    default:
      return undefined;
  }
}
