import { describe, expect, it, vi } from 'vitest';
import {
  UPLOAD_SEQUENCE_STEPS,
  buildMultipartFormData,
  runSinglePartUpload,
  runUploadSequence,
} from '../src/media/multipart.js';
import { PlatformError } from '../src/errors/platform-error.js';
import { ErrorCode } from '../src/errors/error-code.js';
import type { UploadSequence } from '../src/media/multipart.js';

describe('buildMultipartFormData', () => {
  it('builds a FormData from Web APIs alone', async () => {
    const form = buildMultipartFormData([
      { name: 'caption', value: 'hello' },
      {
        name: 'file',
        content: new Uint8Array([1, 2, 3]),
        fileName: 'a.bin',
        contentType: 'application/octet-stream',
      },
    ]);

    expect(form.get('caption')).toBe('hello');
    const file = form.get('file') as File;
    expect(file.name).toBe('a.bin');
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });
});

describe('runSinglePartUpload', () => {
  it('PUTs the bytes and never replays a mutating body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 200 }));

    await runSinglePartUpload({
      url: 'https://upload.example/target',
      body: new Uint8Array([1, 2, 3]),
      totalBytes: 3,
      headers: { authorization: 'Bearer x' },
      fetch: fetchMock as unknown as typeof fetch,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://upload.example/target');
    expect(init.method).toBe('PUT');
    expect((init.headers as Record<string, string>)['content-length']).toBe('3');
  });
});

describe('runUploadSequence', () => {
  function sequenceWith(overrides: Partial<UploadSequence<{ id: string }, string>> = {}) {
    const calls: string[] = [];
    const sequence: UploadSequence<{ id: string }, string> = {
      init: () => {
        calls.push('init');
        return Promise.resolve({ id: 'up-1' });
      },
      upload: () => {
        calls.push('upload');
        return Promise.resolve();
      },
      finalize: () => {
        calls.push('finalize');
        return Promise.resolve('done');
      },
      serializeSession: session => ({ id: session.id }),
      deserializeSession: state => ({ id: String(state.id) }),
      ...overrides,
    };
    return { sequence, calls };
  }

  it('runs the steps in order', async () => {
    const { sequence, calls } = sequenceWith();
    const result = await runUploadSequence(sequence, { platform: 'seq-network' });

    expect(result).toBe('done');
    expect(calls).toEqual(['init', 'upload', 'finalize']);
  });

  it('names the step it failed at, so a retry repeats one step', async () => {
    const { sequence } = sequenceWith({
      finalize: () =>
        Promise.reject(new PlatformError('boom', ErrorCode.PLATFORM_ERROR, { retryable: true })),
    });

    const error = (await runUploadSequence(sequence, { platform: 'seq-network' }).catch(
      (thrown: unknown) => thrown,
    )) as PlatformError;

    expect(error.resumeHandle?.step).toBe(UPLOAD_SEQUENCE_STEPS.FINALIZE);
    expect(error.resumeHandle?.state).toEqual({ id: 'up-1' });
  });

  it('resumes from the failed step without opening a second session', async () => {
    const { sequence, calls } = sequenceWith();

    await runUploadSequence(sequence, {
      platform: 'seq-network',
      resume: {
        platform: 'seq-network',
        step: UPLOAD_SEQUENCE_STEPS.FINALIZE,
        state: { id: 'up-1' },
      },
    });

    expect(calls).toEqual(['finalize']);
  });

  it('ignores a handle from another platform', async () => {
    const { sequence, calls } = sequenceWith();

    await runUploadSequence(sequence, {
      platform: 'seq-network',
      resume: { platform: 'other-network', step: 'finalize', state: { id: 'x' } },
    });

    expect(calls).toEqual(['init', 'upload', 'finalize']);
  });
});
