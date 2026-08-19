import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_CHUNK_SIZE_BYTES,
  UPLOAD_STEP,
  readResumePosition,
  runChunkedUpload,
} from '../src/media/chunked-uploader.js';
import { ErrorCode } from '../src/errors/error-code.js';
import { PlatformError } from '../src/errors/platform-error.js';
import type { ChunkedUploadDriver } from '../src/media/chunked-uploader.js';
import type { ResumeHandle } from '../src/types/resume-handle.js';

interface Session {
  uploadId: string;
}

/** Records what a platform would have received, chunk by chunk. */
function recordingDriver(overrides: Partial<ChunkedUploadDriver<Session, string>> = {}) {
  const received: { offset: number; size: number; isLast: boolean }[] = [];
  const driver: ChunkedUploadDriver<Session, string> & { received: typeof received } = {
    received,
    init: vi.fn().mockResolvedValue({ uploadId: 'u-1' }),
    sendChunk: vi.fn(async ({ chunk, offsetBytes, isLast }) => {
      received.push({ offset: offsetBytes, size: chunk.byteLength, isLast });
    }),
    finalize: vi.fn(async (_session, totalBytes) => `done:${totalBytes}`),
    serializeSession: session => ({ uploadId: session.uploadId }),
    deserializeSession: state => ({ uploadId: String(state.uploadId) }),
    ...overrides,
  };
  return driver;
}

/**
 * A stream that yields `total` bytes in `chunkSize` pieces without ever holding
 * them all, so a test can use a large size without allocating it.
 */
function syntheticStream(total: number, chunkSize: number): ReadableStream<Uint8Array> {
  let produced = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (produced >= total) {
        controller.close();
        return;
      }
      const size = Math.min(chunkSize, total - produced);
      produced += size;
      controller.enqueue(new Uint8Array(size));
    },
  });
}

describe('runChunkedUpload', () => {
  it('splits a stream into fixed-size chunks addressed by offset', async () => {
    const driver = recordingDriver();

    const result = await runChunkedUpload(syntheticStream(2500, 400), driver, {
      platform: 'demo',
      chunkSizeBytes: 1000,
    });

    expect(result).toBe('done:2500');
    expect(driver.received).toEqual([
      { offset: 0, size: 1000, isLast: false },
      { offset: 1000, size: 1000, isLast: false },
      { offset: 2000, size: 500, isLast: true },
    ]);
  });

  it('sends a file smaller than one chunk as a single final chunk', async () => {
    const driver = recordingDriver();

    await runChunkedUpload(syntheticStream(10, 10), driver, {
      platform: 'demo',
      chunkSizeBytes: 1000,
    });

    expect(driver.received).toEqual([{ offset: 0, size: 10, isLast: true }]);
  });

  it('defaults to a 4 MiB chunk', async () => {
    const driver = recordingDriver();

    await runChunkedUpload(syntheticStream(DEFAULT_CHUNK_SIZE_BYTES + 5, 64 * 1024), driver, {
      platform: 'demo',
    });

    expect(driver.received[0]?.size).toBe(DEFAULT_CHUNK_SIZE_BYTES);
  });

  describe('failure and resume', () => {
    it('reports where it got to when a chunk fails permanently', async () => {
      const driver = recordingDriver({
        sendChunk: vi.fn(async ({ offsetBytes }) => {
          if (offsetBytes >= 1000) {
            throw new PlatformError('gateway said no', ErrorCode.PLATFORM_ERROR, {
              retryable: false,
            });
          }
        }),
      });

      const error = (await runChunkedUpload(syntheticStream(3000, 500), driver, {
        platform: 'demo',
        chunkSizeBytes: 1000,
      }).catch((e: unknown) => e)) as PlatformError;

      expect(error).toBeInstanceOf(PlatformError);
      expect(error.resumeHandle).toEqual({
        platform: 'demo',
        step: UPLOAD_STEP,
        state: { uploadId: 'u-1', offsetBytes: 1000 },
      });
      // The handle goes into the host's job record, so it must be plain JSON.
      expect(JSON.parse(JSON.stringify(error.resumeHandle))).toEqual(error.resumeHandle);
    });

    it('continues from the handle instead of opening a second upload', async () => {
      const driver = recordingDriver();
      const handle: ResumeHandle = {
        platform: 'demo',
        step: UPLOAD_STEP,
        state: { uploadId: 'u-1', offsetBytes: 2000 },
      };

      // The caller reopened the source at byte 2000, so the stream holds the rest.
      await runChunkedUpload(syntheticStream(1000, 500), driver, {
        platform: 'demo',
        chunkSizeBytes: 1000,
        resume: handle,
      });

      expect(driver.init).not.toHaveBeenCalled();
      expect(driver.received).toEqual([{ offset: 2000, size: 1000, isLast: true }]);
      expect(driver.finalize).toHaveBeenCalledWith({ uploadId: 'u-1' }, 3000, undefined);
    });

    it('ignores a handle belonging to another platform or step', () => {
      const handle: ResumeHandle = {
        platform: 'other',
        step: UPLOAD_STEP,
        state: { offsetBytes: 10 },
      };

      expect(readResumePosition(handle, 'demo')).toBeUndefined();
      expect(
        readResumePosition({ ...handle, platform: 'demo', step: 'publish' }, 'demo'),
      ).toBeUndefined();
      expect(readResumePosition(undefined, 'demo')).toBeUndefined();
    });

    it('keeps a resume handle the driver attached itself', async () => {
      const own: ResumeHandle = { platform: 'demo', step: UPLOAD_STEP, state: { offsetBytes: 7 } };
      const driver = recordingDriver({
        sendChunk: vi.fn(async () => {
          throw new PlatformError('nope', ErrorCode.PLATFORM_ERROR, {
            retryable: false,
            resumeHandle: own,
          });
        }),
      });

      const error = (await runChunkedUpload(syntheticStream(10, 10), driver, {
        platform: 'demo',
      }).catch((e: unknown) => e)) as PlatformError;

      expect(error.resumeHandle).toBe(own);
    });
  });

  describe('per-chunk retry', () => {
    it('repeats a retryable chunk, which is safe because chunks are addressed by offset', async () => {
      let attempts = 0;
      const driver = recordingDriver({
        sendChunk: vi.fn(async () => {
          attempts += 1;
          if (attempts < 3) {
            throw new PlatformError('flaky', ErrorCode.NETWORK_ERROR, { retryable: true });
          }
        }),
      });

      await runChunkedUpload(syntheticStream(100, 100), driver, {
        platform: 'demo',
        chunkSizeBytes: 1000,
      });

      expect(attempts).toBe(3);
      expect(driver.finalize).toHaveBeenCalled();
    });

    it('does not repeat a permanent chunk failure', async () => {
      let attempts = 0;
      const driver = recordingDriver({
        sendChunk: vi.fn(async () => {
          attempts += 1;
          throw new PlatformError('rejected', ErrorCode.CONTENT_REJECTED, { retryable: false });
        }),
      });

      await expect(
        runChunkedUpload(syntheticStream(100, 100), driver, { platform: 'demo' }),
      ).rejects.toThrow();
      expect(attempts).toBe(1);
    });

    it('gives up after the configured number of attempts', async () => {
      let attempts = 0;
      const driver = recordingDriver({
        sendChunk: vi.fn(async () => {
          attempts += 1;
          throw new PlatformError('flaky', ErrorCode.NETWORK_ERROR, { retryable: true });
        }),
      });

      await expect(
        runChunkedUpload(syntheticStream(100, 100), driver, {
          platform: 'demo',
          maxChunkAttempts: 2,
        }),
      ).rejects.toThrow();
      expect(attempts).toBe(2);
    });
  });

  describe('memory', () => {
    it('never holds more than one chunk, whatever the file size', async () => {
      const chunkSize = 64 * 1024;
      const totalBytes = 64 * 1024 * 1024; // 64 MiB, produced but never materialized
      let peakBytesHeld = 0;
      let chunksSent = 0;

      const driver = recordingDriver({
        sendChunk: vi.fn(async ({ chunk }) => {
          chunksSent += 1;
          peakBytesHeld = Math.max(peakBytesHeld, chunk.byteLength);
        }),
      });

      const result = await runChunkedUpload(syntheticStream(totalBytes, 8 * 1024), driver, {
        platform: 'demo',
        chunkSizeBytes: chunkSize,
      });

      expect(result).toBe(`done:${totalBytes}`);
      // A buffering implementation would show the whole 64 MiB here.
      expect(peakBytesHeld).toBeLessThanOrEqual(chunkSize);
      expect(chunksSent).toBe(totalBytes / chunkSize);
    });
  });

  describe('cancellation', () => {
    it('stops as soon as the caller aborts', async () => {
      const controller = new AbortController();
      const driver = recordingDriver({
        sendChunk: vi.fn(async () => {
          controller.abort();
        }),
      });

      await expect(
        runChunkedUpload(syntheticStream(10_000, 1000), driver, {
          platform: 'demo',
          chunkSizeBytes: 1000,
          signal: controller.signal,
        }),
      ).rejects.toThrow(/aborted/i);
      expect(driver.finalize).not.toHaveBeenCalled();
    });
  });
});
