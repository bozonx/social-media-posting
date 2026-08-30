import { describe, expect, it } from 'vitest';
import { runChunkedUpload } from '../src/media/chunked-uploader.js';
import type { ChunkedUploadDriver } from '../src/media/chunked-uploader.js';
import type { PlatformError } from '../src/errors/platform-error.js';

/**
 * A file larger than a worker's memory, produced a chunk at a time and never
 * held whole.
 *
 * This suite also runs under `workerd` (see `vitest.workerd.config.ts`), where
 * the isolate's memory limit is 128 MB. Passing there is the actual claim: a
 * 512 MB video streams through the uploader without ever being materialized.
 */
const MIB = 1024 * 1024;
const TOTAL_BYTES = 512 * MIB;
const SOURCE_CHUNK = 1 * MIB;

function syntheticStream(totalBytes: number): ReadableStream<Uint8Array> {
  let produced = 0;
  const block = new Uint8Array(SOURCE_CHUNK).fill(7);

  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (produced >= totalBytes) {
        controller.close();
        return;
      }
      const size = Math.min(SOURCE_CHUNK, totalBytes - produced);
      produced += size;
      // A fresh view each time, never a growing buffer.
      controller.enqueue(block.subarray(0, size));
    },
  });
}

describe('streaming a file larger than memory', () => {
  it('uploads it chunk by chunk, holding one chunk at a time', async () => {
    let received = 0;
    let largestChunkSeen = 0;
    let sawLast = false;

    const driver: ChunkedUploadDriver<{ id: string }, { ok: true }> = {
      init: () => Promise.resolve({ id: 'session-1' }),
      sendChunk: context => {
        expect(context.offsetBytes).toBe(received);
        received += context.chunk.byteLength;
        largestChunkSeen = Math.max(largestChunkSeen, context.chunk.byteLength);
        sawLast ||= context.isLast;
        return Promise.resolve();
      },
      finalize: () => Promise.resolve({ ok: true } as const),
      serializeSession: session => ({ id: session.id }),
      deserializeSession: state => ({ id: String(state.id) }),
    };

    const chunkSizeBytes = 4 * MIB;
    const result = await runChunkedUpload(syntheticStream(TOTAL_BYTES), driver, {
      platform: 'streaming-network',
      chunkSizeBytes,
      totalBytes: TOTAL_BYTES,
    });

    expect(result).toEqual({ ok: true });
    expect(received).toBe(TOTAL_BYTES);
    expect(sawLast).toBe(true);
    // Peak memory is one chunk, whatever the file's size.
    expect(largestChunkSeen).toBeLessThanOrEqual(chunkSizeBytes + SOURCE_CHUNK);
  });

  it('resumes at the offset it reached instead of re-sending the file', async () => {
    const failAt = 8 * MIB;
    let received = 0;

    const failing: ChunkedUploadDriver<{ id: string }, { ok: true }> = {
      init: () => Promise.resolve({ id: 'session-2' }),
      sendChunk: context => {
        if (context.offsetBytes >= failAt) {
          return Promise.reject(new Error('connection dropped'));
        }
        received += context.chunk.byteLength;
        return Promise.resolve();
      },
      finalize: () => Promise.resolve({ ok: true } as const),
      serializeSession: session => ({ id: session.id }),
      deserializeSession: state => ({ id: String(state.id) }),
    };

    const failure = (await runChunkedUpload(syntheticStream(32 * MIB), failing, {
      platform: 'streaming-network',
      chunkSizeBytes: 4 * MIB,
      maxChunkAttempts: 1,
    }).catch((error: unknown) => error)) as PlatformError;

    expect(failure.resumeHandle?.state.offsetBytes).toBe(received);
    expect(received).toBe(failAt);
  });
});
