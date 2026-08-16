import { ErrorCode } from '../errors/error-code.js';
import { PlatformError } from '../errors/platform-error.js';
import { AbortedError } from '../errors/posting-error.js';
import type { JsonValue, ResumeHandle } from '../types/resume-handle.js';

/** Default chunk size: large enough to be efficient, small enough to stay in memory. */
export const DEFAULT_CHUNK_SIZE_BYTES = 4 * 1024 * 1024;

/** Step names a {@link ResumeHandle} from an upload can carry. */
export const UPLOAD_STEP = 'upload';

/** What one chunk send is told. */
export interface ChunkContext<TSession> {
  /** Whatever `init()` returned: upload URL, session id, and so on. */
  session: TSession;
  /** The bytes to send. */
  chunk: Uint8Array;
  /** Byte offset of this chunk within the whole file. */
  offsetBytes: number;
  /** Total size, when it is known up front. */
  totalBytes?: number;
  /** Whether this is the final chunk. */
  isLast: boolean;
  /** Aborts the send. */
  signal?: AbortSignal;
}

/**
 * The three steps every chunked upload API is made of, whatever it calls them:
 * X's INIT/APPEND/FINALIZE, YouTube's resumable session, TikTok's init plus
 * PUT, LinkedIn's register plus PUT.
 */
export interface ChunkedUploadDriver<TSession, TResult> {
  /** Open an upload session. Skipped entirely when resuming. */
  init(signal?: AbortSignal): Promise<TSession>;
  /** Send one chunk. Must be safe to repeat: chunks are addressed by offset. */
  sendChunk(context: ChunkContext<TSession>): Promise<void>;
  /** Complete the upload once every chunk is in. */
  finalize(session: TSession, totalBytes: number, signal?: AbortSignal): Promise<TResult>;
  /** Render the session into JSON, so a failed upload can be resumed later. */
  serializeSession(session: TSession): Record<string, JsonValue>;
  /** Rebuild the session from a resume handle's state. */
  deserializeSession(state: Record<string, JsonValue>): TSession;
}

/** Knobs for one run of {@link runChunkedUpload}. */
export interface ChunkedUploadOptions {
  /** Platform name, stamped into any resume handle. */
  platform: string;
  /** Bytes per chunk (default: 4 MiB). */
  chunkSizeBytes?: number;
  /** Total size, when it is known up front. */
  totalBytes?: number;
  /**
   * A handle from a previous failed attempt. The upload continues from its
   * offset instead of starting over — which is what stops a retry creating a
   * second uploaded file.
   */
  resume?: ResumeHandle;
  /**
   * Attempts per chunk (default: 3).
   *
   * This is the one place the library retries beyond the transport level, and
   * it is safe for a specific reason: a chunk is addressed by its byte offset,
   * so re-sending it overwrites rather than appends. Nothing about the post as
   * a whole is repeated.
   */
  maxChunkAttempts?: number;
  /** Aborts the upload. */
  signal?: AbortSignal;
}

/**
 * Where an upload got to, for the caller to reopen the source from.
 */
export interface ResumePosition {
  offsetBytes: number;
  state: Record<string, JsonValue>;
}

/**
 * Read a resume handle produced by a previous upload of this media.
 *
 * @param handle - The handle from `error.resumeHandle`.
 * @param platform - The platform about to resume.
 * @returns Where to reopen the source, or undefined when the handle does not apply.
 */
export function readResumePosition(
  handle: ResumeHandle | undefined,
  platform: string,
): ResumePosition | undefined {
  if (!handle || handle.platform !== platform || handle.step !== UPLOAD_STEP) {
    return undefined;
  }
  const offsetBytes = handle.state.offsetBytes;
  if (typeof offsetBytes !== 'number') {
    return undefined;
  }
  return { offsetBytes, state: handle.state };
}

/**
 * Drive a chunked upload from a stream, holding one chunk at a time.
 *
 * The whole point is that the file is never materialized: peak memory is one
 * chunk, whatever the file's size. That matters for a host running several
 * uploads in parallel, and it is the difference between "runs on Workers" and
 * "runs on Workers for small files only".
 *
 * @param stream - The media bytes, already positioned at `resume`'s offset if resuming.
 * @param driver - The platform's init/send/finalize implementation.
 * @param options - Chunk size, resume handle, abort signal.
 * @returns Whatever `finalize()` returns.
 * @throws PlatformError carrying a `resumeHandle` when the upload failed part way.
 */
export async function runChunkedUpload<TSession, TResult>(
  stream: ReadableStream<Uint8Array>,
  driver: ChunkedUploadDriver<TSession, TResult>,
  options: ChunkedUploadOptions,
): Promise<TResult> {
  const chunkSize = options.chunkSizeBytes ?? DEFAULT_CHUNK_SIZE_BYTES;
  const maxAttempts = options.maxChunkAttempts ?? 3;
  const resumed = readResumePosition(options.resume, options.platform);

  const session = resumed
    ? driver.deserializeSession(resumed.state)
    : await driver.init(options.signal);

  let offset = resumed?.offsetBytes ?? 0;
  const reader = stream.getReader();
  let pending: Uint8Array<ArrayBuffer> = new Uint8Array(0);

  const handleFor = (at: number): ResumeHandle => ({
    platform: options.platform,
    step: UPLOAD_STEP,
    state: { ...driver.serializeSession(session), offsetBytes: at },
  });

  try {
    for (;;) {
      if (options.signal?.aborted) {
        throw new AbortedError('Upload aborted', ErrorCode.NETWORK_ERROR);
      }

      const { value, done } = await reader.read();
      if (value) {
        pending = concat(pending, value as Uint8Array<ArrayBuffer>);
      }

      // Hold back a full chunk until the stream says whether more follows: a
      // platform that treats the final chunk specially must not be told the
      // last one is an intermediate.
      while (pending.byteLength > chunkSize || (done && pending.byteLength > 0)) {
        const size = Math.min(chunkSize, pending.byteLength);
        const isLast = done && size === pending.byteLength;

        await sendWithRetries(
          driver,
          {
            session,
            chunk: pending.subarray(0, size),
            offsetBytes: offset,
            totalBytes: options.totalBytes,
            isLast,
            signal: options.signal,
          },
          maxAttempts,
          () => handleFor(offset),
        );

        offset += size;
        pending = pending.subarray(size);
      }

      if (done) {
        break;
      }
    }

    return await driver.finalize(session, offset, options.signal);
  } catch (error) {
    throw withResumeHandle(error, handleFor(offset));
  } finally {
    reader.releaseLock();
  }
}

/**
 * Send one chunk, repeating it on a retryable failure.
 *
 * Safe precisely because the chunk is addressed by offset: a repeat overwrites
 * the same range rather than appending a second copy.
 */
async function sendWithRetries<TSession>(
  driver: ChunkedUploadDriver<TSession, unknown>,
  context: ChunkContext<TSession>,
  maxAttempts: number,
  handle: () => ResumeHandle,
): Promise<void> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await driver.sendChunk(context);
      return;
    } catch (error) {
      lastError = error;
      const retryable = error instanceof PlatformError ? error.retryable : false;
      if (!retryable || attempt === maxAttempts || context.signal?.aborted) {
        break;
      }
    }
  }

  throw withResumeHandle(lastError, handle());
}

/**
 * Attach where the upload got to, so the host's next attempt continues instead
 * of restarting.
 */
function withResumeHandle(error: unknown, resumeHandle: ResumeHandle): PlatformError {
  if (error instanceof PlatformError) {
    if (error.resumeHandle) {
      return error;
    }
    return new PlatformError(error.message, error.code, {
      retryable: error.retryable,
      retryAfterMs: error.retryAfterMs,
      httpStatus: error.httpStatus,
      platformCode: error.platformCode,
      cause: error.cause ?? error,
      raw: error.raw,
      resumeHandle,
    });
  }

  return new PlatformError(
    (error as Error)?.message ?? 'Chunked upload failed',
    ErrorCode.PLATFORM_ERROR,
    { retryable: true, cause: error, resumeHandle },
  );
}

function concat(
  left: Uint8Array<ArrayBuffer>,
  right: Uint8Array<ArrayBuffer>,
): Uint8Array<ArrayBuffer> {
  if (left.byteLength === 0) {
    return right;
  }
  const merged = new Uint8Array(left.byteLength + right.byteLength);
  merged.set(left, 0);
  merged.set(right, left.byteLength);
  return merged;
}
