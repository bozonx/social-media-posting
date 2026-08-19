import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { httpRequest } from '../src/http/http-request.js';
import { ErrorCode } from '../src/errors/error-code.js';
import { PlatformError } from '../src/errors/platform-error.js';

const originalFetch = globalThis.fetch;

describe('httpRequest', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns the response without retrying when the call succeeds', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('ok'));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const response = await httpRequest('https://api.example.com/send');

    expect(await response.text()).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry an error response — that is the host’s call', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('nope', { status: 500 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const response = await httpRequest('https://api.example.com/send');

    expect(response.status).toBe(500);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry a POST when fetch rejects because the platform may have acted', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValue(new Response('ok'));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      httpRequest('https://api.example.com/send', { method: 'POST', body: 'payload' }),
    ).rejects.toBeInstanceOf(PlatformError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('gives up after the single retry', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(httpRequest('https://api.example.com/send')).rejects.toBeInstanceOf(PlatformError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('never replays a streamed body', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('chunk'));
        controller.close();
      },
    });

    await expect(
      httpRequest('https://api.example.com/upload', { method: 'POST', body }),
    ).rejects.toBeInstanceOf(PlatformError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('honours an explicit replayableBody: false', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      httpRequest('https://api.example.com/upload', {
        method: 'POST',
        body: 'already-sent',
        replayableBody: false,
      }),
    ).rejects.toBeInstanceOf(PlatformError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('classifies a connection failure as a retryable network error', async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new TypeError('fetch failed')) as unknown as typeof fetch;

    const error = (await httpRequest('https://api.example.com/send').catch(
      (e: unknown) => e,
    )) as PlatformError;

    expect(error.code).toBe(ErrorCode.NETWORK_ERROR);
    expect(error.retryable).toBe(true);
    // The message names the host, never the path — bot tokens live in paths.
    expect(error.message).toContain('api.example.com');
  });

  it('does not retry once the caller aborted', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn().mockImplementation(() => {
      controller.abort();
      return Promise.reject(new DOMException('Aborted', 'AbortError'));
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      httpRequest('https://api.example.com/send', { signal: controller.signal }),
    ).rejects.toBeInstanceOf(PlatformError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('detects abortion when signal is aborted during the retry attempt', async () => {
    const controller = new AbortController();
    let callCount = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      callCount += 1;
      if (callCount === 2) {
        controller.abort();
      }
      return Promise.reject(new TypeError('fetch failed'));
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const error = await httpRequest('https://api.example.com/send', {
      signal: controller.signal,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PlatformError);
    expect((error as PlatformError).message).toBe('Request aborted');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('classifies AbortSignal.timeout as a retryable timeout', async () => {
    const signal = AbortSignal.timeout(1);
    await new Promise(resolve => setTimeout(resolve, 5));
    globalThis.fetch = vi.fn().mockRejectedValue(signal.reason) as unknown as typeof fetch;

    const error = (await httpRequest('https://api.example.com/send', { signal }).catch(
      (thrown: unknown) => thrown,
    )) as PlatformError;

    expect(error.code).toBe(ErrorCode.TIMEOUT_ERROR);
    expect(error.retryable).toBe(true);
  });

  it('uses fallback host name in error message when URL is invalid', async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new TypeError('fetch failed')) as unknown as typeof fetch;

    const error = (await httpRequest('not-a-valid-url').catch((e: unknown) => e)) as PlatformError;

    expect(error.message).toContain('the platform');
  });
});
