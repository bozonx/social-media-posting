import { vi } from 'vitest';
import { ErrorCode, PostType } from '@bozonx/social-posting';
import { describePlatformContract } from '@bozonx/social-posting-conformance';
import type { ContractHarness, RecordedResponse } from '@bozonx/social-posting-conformance';
import type { ILogger, ResolvedAccountConfig } from '@bozonx/social-posting';
import { x } from '../src/index.js';
import errors from './fixtures/errors.json' with { type: 'json' };

const silentLogger: ILogger = { debug: () => {}, log: () => {}, warn: () => {}, error: () => {} };

const accountConfig: ResolvedAccountConfig = {
  platform: 'x',
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
    platform: x.create({ logger: silentLogger }),
    accountConfig,

    respondSuccess() {
      respond(
        () =>
          new Response(JSON.stringify({ id: '1', url: 'https://x.example/1' }), {
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
          if (init?.signal?.aborted) {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
            return;
          }
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
  module: x,
  createHarness,

  requests: {
    [PostType.POST]: { platform: 'x', body: 'Post', type: PostType.POST },
    [PostType.IMAGE]: {
      platform: 'x',
      type: PostType.IMAGE,
      media: [{ type: 'image', source: { kind: 'platformRef', ref: '1' } }],
    },
    [PostType.VIDEO]: {
      platform: 'x',
      type: PostType.VIDEO,
      media: [{ type: 'video', source: { kind: 'platformRef', ref: '2' } }],
    },
    [PostType.SHORT_VIDEO]: {
      platform: 'x',
      type: PostType.SHORT_VIDEO,
      media: [{ type: 'video', source: { kind: 'platformRef', ref: '2' } }],
    },
    [PostType.POLL]: {
      platform: 'x',
      type: PostType.POLL,
      body: 'Choose',
      poll: { options: ['A', 'B'], durationSecs: 3600 },
    },
  },

  overLimitRequest: {
    request: { platform: 'x', body: 'x'.repeat(281), type: PostType.POST },
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
