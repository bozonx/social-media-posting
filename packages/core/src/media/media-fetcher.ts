import { ErrorCode } from '../errors/error-code.js';
import { PlatformError } from '../errors/platform-error.js';
import { ValidationError } from '../errors/posting-error.js';
import { httpRequest } from '../http/http-request.js';
import { SNIFF_BYTES, mediaKindOf, sniffMimeType } from './mime-sniffer.js';
import { knownSizeBytes } from './media-source.js';
import type { MediaKind } from './mime-sniffer.js';
import type { MediaSource } from './media-source.js';
import type { MediaConstraints, PlatformCapabilities } from '../platforms/capabilities.js';

/** What is known about a media item before its bytes are moved. */
export interface MediaMetadata {
  mimeType?: string;
  sizeBytes?: number;
  fileName?: string;
  kind: MediaKind;
}

/** An opened media item: metadata plus the bytes, still unread. */
export interface OpenedMedia extends MediaMetadata {
  stream: ReadableStream<Uint8Array>;
}

export interface MediaFetcherOptions {
  /** Host policy for remote media URLs (for example, an SSRF allow-list). */
  validateUrl?: (url: URL) => void | Promise<void>;
}

/**
 * Opens media for upload without ever holding the whole file.
 *
 * Two things it does that a naive `await response.arrayBuffer()` does not:
 * it checks the platform's declared limits *before* paying for the download,
 * and it identifies the media type from the file's own leading bytes rather
 * than from an extension in the URL.
 */
export class MediaFetcher {
  constructor(private readonly options: MediaFetcherOptions = {}) {}

  /**
   * Read what is knowable about a media item without downloading it.
   *
   * @param source - Where the media comes from.
   * @param signal - Aborts the probe.
   * @returns Type, size and name, as far as the source reveals them.
   */
  async probe(source: MediaSource, signal?: AbortSignal): Promise<MediaMetadata> {
    if (source.kind === 'platformRef') {
      throw new ValidationError('Media already stored by the platform has no bytes to probe');
    }

    if (source.kind !== 'url') {
      const rawMime = source.kind === 'blob' ? source.blob.type : source.mimeType;
      const mimeType = rawMime && rawMime.length > 0 ? rawMime : undefined;
      return {
        mimeType,
        sizeBytes: knownSizeBytes(source),
        fileName: source.fileName,
        kind: mediaKindOf(mimeType),
      };
    }

    await this.validateRemoteUrl(source.url);

    const response = await this.fetchRemote(source.url, { method: 'HEAD', signal });
    if (!response.ok) {
      // Not every origin answers HEAD; the size check then happens while streaming.
      return { mimeType: source.mimeType, kind: mediaKindOf(source.mimeType) };
    }

    const mimeType = headerMimeType(response) ?? source.mimeType;
    const length = Number(response.headers.get('content-length'));

    return {
      mimeType,
      sizeBytes: Number.isFinite(length) && length > 0 ? length : undefined,
      fileName: source.fileName,
      kind: mediaKindOf(mimeType),
    };
  }

  /**
   * Open a media item for upload, checking it against the platform's limits.
   *
   * The size is checked before the download starts whenever the origin states
   * it, and again while streaming when it does not — so an origin that lies
   * about `content-length` cannot make this process buffer an unbounded file.
   *
   * @param source - Where the media comes from.
   * @param capabilities - What the platform accepts.
   * @param signal - Aborts the download.
   * @returns The metadata and an unread stream of the bytes.
   * @throws ValidationError when the media breaks a declared limit.
   */
  async open(
    source: MediaSource,
    capabilities?: PlatformCapabilities,
    signal?: AbortSignal,
  ): Promise<OpenedMedia> {
    if (source.kind === 'platformRef') {
      throw new ValidationError('Media already stored by the platform has no bytes to upload');
    }

    const metadata = await this.probe(source, signal);
    const constraints = constraintsFor(capabilities, metadata.kind);

    // Cheapest check first: refuse before spending the download.
    assertWithinLimits(metadata, constraints);

    const raw = await this.openStream(source, signal);
    const { stream, mimeType } = await withSniffedMimeType(raw, metadata.mimeType);

    const resolved: MediaMetadata = { ...metadata, mimeType, kind: mediaKindOf(mimeType) };
    const resolvedConstraints = constraintsFor(capabilities, resolved.kind);
    assertMimeAllowed(resolved, resolvedConstraints);

    return {
      ...resolved,
      stream: enforceSizeLimit(stream, resolvedConstraints?.maxBytes),
    };
  }

  private async openStream(
    source: Exclude<MediaSource, { kind: 'platformRef' }>,
    signal?: AbortSignal,
    offsetBytes?: number,
  ): Promise<ReadableStream<Uint8Array>> {
    switch (source.kind) {
      case 'bytes':
        return streamOfBytes(source.bytes.subarray(offsetBytes ?? 0));
      case 'blob':
        return source.blob.slice(offsetBytes ?? 0).stream();
      case 'stream':
        return source.open({ offsetBytes, signal });
      case 'url': {
        await this.validateRemoteUrl(source.url);
        const headers: Record<string, string> = {};
        if (offsetBytes) {
          headers.range = `bytes=${offsetBytes}-`;
        }
        const response = await this.fetchRemote(source.url, { headers, signal });
        if (!response.ok || !response.body) {
          throw new PlatformError(
            `Fetching media from ${safeHost(source.url)} failed with ${response.status}`,
            ErrorCode.NETWORK_ERROR,
            { retryable: response.status >= 500, httpStatus: response.status },
          );
        }
        return response.body;
      }
    }
  }

  private async validateRemoteUrl(url: string): Promise<void> {
    if (this.options.validateUrl) {
      await this.options.validateUrl(new URL(url));
    }
  }

  /** Follow redirects one hop at a time so the host policy sees every URL. */
  private async fetchRemote(url: string, init: RequestInit): Promise<Response> {
    let currentUrl = url;
    for (let redirects = 0; redirects <= 5; redirects += 1) {
      await this.validateRemoteUrl(currentUrl);
      const response = await httpRequest(currentUrl, { ...init, redirect: 'manual' });
      if (response.status < 300 || response.status >= 400) return response;

      const location = response.headers.get('location');
      if (!location) return response;
      currentUrl = new URL(location, currentUrl).toString();
    }
    throw new ValidationError('Media URL exceeded the maximum of 5 redirects');
  }

  /**
   * Re-open a source part way through, for an upload resuming from an offset.
   *
   * @param source - Where the media comes from.
   * @param offsetBytes - How many bytes the previous attempt already sent.
   * @param signal - Aborts the download.
   */
  async openAt(
    source: MediaSource,
    offsetBytes: number,
    signal?: AbortSignal,
  ): Promise<ReadableStream<Uint8Array>> {
    if (source.kind === 'platformRef') {
      throw new ValidationError('Media already stored by the platform has no bytes to upload');
    }
    return this.openStream(source, signal, offsetBytes);
  }
}

function headerMimeType(response: Response): string | undefined {
  const value = response.headers.get('content-type');
  const mime = value?.split(';')[0]?.trim();
  return mime && mime.length > 0 ? mime : undefined;
}

function constraintsFor(
  capabilities: PlatformCapabilities | undefined,
  kind: MediaKind,
): MediaConstraints | undefined {
  return capabilities?.media?.[kind];
}

function assertWithinLimits(metadata: MediaMetadata, constraints?: MediaConstraints): void {
  if (!constraints) {
    return;
  }
  if (
    constraints.maxBytes !== undefined &&
    metadata.sizeBytes !== undefined &&
    metadata.sizeBytes > constraints.maxBytes
  ) {
    throw new ValidationError(
      `Media is ${metadata.sizeBytes} bytes, over the ${constraints.maxBytes} byte limit for ${metadata.kind}`,
    );
  }
  assertMimeAllowed(metadata, constraints);
}

function assertMimeAllowed(metadata: MediaMetadata, constraints?: MediaConstraints): void {
  if (!constraints?.mimeTypes?.length || !metadata.mimeType) {
    return;
  }
  if (!constraints.mimeTypes.includes(metadata.mimeType)) {
    throw new ValidationError(
      `Media type ${metadata.mimeType} is not accepted; allowed: ${constraints.mimeTypes.join(', ')}`,
    );
  }
}

/**
 * Prefix a stream with a sniffed MIME type without buffering it.
 *
 * One small read determines the magic bytes; a prepended `ReadableStream`
 * still yields those bytes. Nothing beyond the first chunk is held.
 */
async function withSniffedMimeType(
  stream: ReadableStream<Uint8Array>,
  declared: string | undefined,
): Promise<{ stream: ReadableStream<Uint8Array>; mimeType: string | undefined }> {
  const reader = stream.getReader();
  const first = await reader.read();

  if (first.done) {
    reader.releaseLock();
    return { stream: streamOfBytes(new Uint8Array()), mimeType: declared };
  }

  const sniffed = sniffMimeType(first.value.subarray(0, SNIFF_BYTES));

  const replayed = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(first.value);
    },
    async pull(controller) {
      const next = await reader.read();
      if (next.done) {
        controller.close();
        reader.releaseLock();
        return;
      }
      controller.enqueue(next.value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });

  // The origin's own header wins when it is specific; sniffing rescues the
  // common case of `application/octet-stream` or a missing header.
  const trustDeclared = declared && declared !== 'application/octet-stream';
  return { stream: replayed, mimeType: trustDeclared ? declared : (sniffed ?? declared) };
}

/**
 * Fail an oversized download while it is still streaming, so an origin that
 * understates `content-length` cannot force this process to buffer the rest.
 */
function enforceSizeLimit(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number | undefined,
): ReadableStream<Uint8Array> {
  if (maxBytes === undefined) {
    return stream;
  }

  let seen = 0;
  return stream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        seen += chunk.byteLength;
        if (seen > maxBytes) {
          controller.error(
            new ValidationError(`Media exceeds the ${maxBytes} byte limit while downloading`),
          );
          return;
        }
        controller.enqueue(chunk);
      },
    }),
  );
}

function streamOfBytes(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (bytes.byteLength > 0) {
        controller.enqueue(bytes);
      }
      controller.close();
    },
  });
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'the origin';
  }
}
