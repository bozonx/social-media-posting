import { ValidationError } from '../errors/posting-error.js';
import type { MediaInput, MediaSourceInput } from '../types/media-input.js';
import type { PlatformCapabilities } from '../platforms/capabilities.js';

/**
 * Where the bytes of one media item come from, at the library's internal
 * boundary.
 *
 * Inside, a platform has to know whether it can hand the network a URL and let
 * it fetch, or whether it must move the bytes itself — and if so, whether they
 * are already in memory or have to be streamed.
 *
 * There is deliberately no Node `Readable`. A `ReadableStream` is the web
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
  mimeType?: string;
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
  mimeType?: string;
  fileName?: string;
}

/**
 * Read a request's media field as a {@link MediaSource}.
 *
 * @param input - The media input from the request.
 * @returns A normalized MediaSource.
 * @throws ValidationError if the input does not carry a valid source.
 */
export function toMediaSource(input: MediaInput): MediaSource {
  if (
    typeof input !== 'object' ||
    (input as unknown) === null ||
    typeof input.source !== 'object' ||
    (input.source as unknown) === null
  ) {
    throw new ValidationError('MediaInput must carry a source object');
  }

  const { mimeType, fileName } = input;
  const source = input.source;

  switch (source.kind) {
    case 'url':
      if (!source.url || typeof source.url !== 'string' || source.url.trim() === '') {
        throw new ValidationError("Field 'source.url' must be a non-empty string");
      }
      return { kind: 'url', url: source.url, mimeType, fileName };
    case 'bytes':
      if (!(source.bytes instanceof Uint8Array)) {
        throw new ValidationError("Field 'source.bytes' must be a Uint8Array");
      }
      return { kind: 'bytes', bytes: source.bytes, mimeType, fileName };
    case 'blob':
      return {
        kind: 'blob',
        blob: source.blob,
        mimeType: mimeType ?? source.blob.type,
        fileName,
      };
    case 'stream':
      if (typeof source.open !== 'function') {
        throw new ValidationError("Field 'source.open' must be a function");
      }
      return {
        kind: 'stream',
        open: source.open,
        sizeBytes: source.sizeBytes,
        mimeType,
        fileName,
      };
    case 'platformRef':
      if (!source.ref || typeof source.ref !== 'string' || source.ref.trim() === '') {
        throw new ValidationError("Field 'source.ref' must be a non-empty string");
      }
      return { kind: 'platformRef', ref: source.ref, mimeType, fileName };
    default:
      throw new ValidationError(`Unknown media source kind: ${(source as { kind?: string }).kind}`);
  }
}

/**
 * Whether this library has to move the bytes itself.
 *
 * @param source - Where the media comes from.
 * @param capabilitiesOrSources - Platform capabilities or list of accepted source kinds.
 * @param mediaKind - Optional specific media kind ('image', 'video', etc.).
 * @returns True when the bytes must be uploaded by this process.
 */
export function requiresByteUpload(
  source: MediaSource,
  capabilitiesOrSources?: PlatformCapabilities | MediaSourceInput['kind'][],
  mediaKind?: 'image' | 'video' | 'audio' | 'document',
): boolean {
  if (source.kind === 'platformRef') {
    return false;
  }

  let acceptedSources: MediaSourceInput['kind'][] | undefined;
  if (Array.isArray(capabilitiesOrSources)) {
    acceptedSources = capabilitiesOrSources;
  } else if (capabilitiesOrSources && typeof capabilitiesOrSources === 'object') {
    const mediaConstraints = mediaKind ? capabilitiesOrSources.media?.[mediaKind] : undefined;
    if (mediaConstraints?.acceptedSources) {
      acceptedSources = mediaConstraints.acceptedSources;
    } else {
      const allKinds: ('image' | 'video' | 'audio' | 'document')[] = [
        'image',
        'video',
        'audio',
        'document',
      ];
      for (const k of allKinds) {
        const acc = capabilitiesOrSources.media?.[k]?.acceptedSources;
        if (acc?.includes('url')) {
          acceptedSources = acc;
          break;
        }
      }
    }
  }

  if (source.kind === 'url' && acceptedSources?.includes('url')) {
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
