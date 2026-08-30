import { vi } from 'vitest';
import { ErrorCode, PostType } from '@bozonx/social-posting';
import { describePlatformContract } from '@bozonx/social-posting-conformance';
import type { ContractHarness, RecordedResponse } from '@bozonx/social-posting-conformance';
import type { ILogger, ResolvedAccountConfig } from '@bozonx/social-posting';
import { threads } from '../src/index.js';
import errors from './fixtures/errors.json' with { type: 'json' };

const silentLogger: ILogger = { debug: () => {}, log: () => {}, warn: () => {}, error: () => {} };

const accountConfig: ResolvedAccountConfig = {
  platform: 'threads',
  target: { id: 'user-1' },
  source: 'account',
  auth: { accessToken: 'test-token' },
};

function createHarness(): ContractHarness {
  const originalFetch = globalThis.fetch;
  let calls = 0;

  const respond = (body: () => Response) => {
    globalThis.fetch = (() => {
      calls += 1;
      return Promise.resolve(body());
    }) as unknown as typeof fetch;
  };

  return {
    platform: threads.create({ logger: silentLogger }),
    accountConfig,

    respondSuccess() {
      respond(
        () =>
          new Response(JSON.stringify({ id: '1', url: 'https://threads.example/1' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      );
    },

    respondWith(recorded: RecordedResponse) {
      respond(
        () =>
          new Response(JSON.stringify(recorded.body ?? {}), {
            status: recorded.status,
            headers: { 'content-type': 'application/json', ...recorded.headers },
          }),
      );
    },

    respondNever() {
      globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
        calls += 1;
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        });
      }) as unknown as typeof fetch;
    },

    callCount: () => calls,

    restore() {
      globalThis.fetch = originalFetch;
      vi.restoreAllMocks();
    },
  };
}

describePlatformContract({
  module: threads,
  createHarness,

  requests: {
    [PostType.POST]: {
      platform: 'threads',
      target: { id: 'user-1' },
      account: 'main',
      body: 'Contract suite post',
      type: PostType.POST,
    },
    [PostType.IMAGE]: {
      platform: 'threads',
      target: { id: 'user-1' },
      type: PostType.IMAGE,
      media: [{ type: 'image', source: { kind: 'url', url: 'https://example.com/a.jpg' } }],
    },
    [PostType.VIDEO]: {
      platform: 'threads',
      target: { id: 'user-1' },
      type: PostType.VIDEO,
      media: [{ type: 'video', source: { kind: 'url', url: 'https://example.com/a.mp4' } }],
    },
    [PostType.SHORT_VIDEO]: {
      platform: 'threads',
      target: { id: 'user-1' },
      type: PostType.SHORT_VIDEO,
      media: [{ type: 'video', source: { kind: 'url', url: 'https://example.com/a.mp4' } }],
    },
    [PostType.ALBUM]: {
      platform: 'threads',
      target: { id: 'user-1' },
      type: PostType.ALBUM,
      media: [
        { type: 'image', source: { kind: 'url', url: 'https://example.com/a.jpg' } },
        { type: 'image', source: { kind: 'url', url: 'https://example.com/b.jpg' } },
      ],
    },
  },
  overLimitRequest: {
    request: {
      platform: 'threads',
      target: { id: 'user-1' },
      account: 'contract',
      body: 'x'.repeat(501),
      type: PostType.POST,
    },
    expectedError: /body/i,
  },

  errorCases: [
    {
      name: 'a rate limit with retry-after',
      response: errors.rateLimited as RecordedResponse,
      expect: {
        code: ErrorCode.RATE_LIMIT_ERROR,
        retryable: true,
        retryAfterMs: 30_000,
        httpStatus: 429,
      },
    },
    {
      name: 'rejected credentials',
      response: errors.unauthorized as RecordedResponse,
      expect: { code: ErrorCode.AUTH_REFRESH_REQUIRED, retryable: false, httpStatus: 401 },
    },
    {
      name: 'an outage',
      response: errors.serverError as RecordedResponse,
      expect: { code: ErrorCode.PLATFORM_ERROR, retryable: true, httpStatus: 503 },
    },
  ],
});
