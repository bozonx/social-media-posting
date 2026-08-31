import { vi } from 'vitest';
import { ErrorCode, PostType } from '@bozonx/social-posting';
import { describePlatformContract } from '@bozonx/social-posting-conformance';
import type { ContractHarness, RecordedResponse } from '@bozonx/social-posting-conformance';
import type { ILogger, ResolvedAccountConfig } from '@bozonx/social-posting';
import { pinterest } from '../src/index.js';
import errors from './fixtures/errors.json' with { type: 'json' };

const silentLogger: ILogger = { debug: () => {}, log: () => {}, warn: () => {}, error: () => {} };

const accountConfig: ResolvedAccountConfig = {
  platform: 'pinterest',
  target: { id: 'board-1' },
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
    platform: pinterest.create({ logger: silentLogger }),
    accountConfig,

    respondSuccess() {
      respond(
        () =>
          new Response(JSON.stringify({ id: '1', url: 'https://pinterest.example/1' }), {
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
  module: pinterest,
  createHarness,

  requests: {
    [PostType.IMAGE]: {
      platform: 'pinterest',
      target: { id: 'board-1' },
      title: 'Image',
      type: PostType.IMAGE,
      media: [{ type: 'image', source: { kind: 'url', url: 'https://example.com/a.jpg' } }],
    },
    [PostType.VIDEO]: {
      platform: 'pinterest',
      target: { id: 'board-1' },
      title: 'Video',
      type: PostType.VIDEO,
      thumbnail: { source: { kind: 'url', url: 'https://example.com/cover.jpg' } },
      media: [
        {
          type: 'video',
          source: { kind: 'platformRef', ref: 'media-1' },
          thumbnail: { source: { kind: 'url', url: 'https://example.com/cover.jpg' } },
        },
      ],
    },
    [PostType.SHORT_VIDEO]: {
      platform: 'pinterest',
      target: { id: 'board-1' },
      title: 'Short video',
      type: PostType.SHORT_VIDEO,
      thumbnail: { source: { kind: 'url', url: 'https://example.com/cover.jpg' } },
      media: [
        {
          type: 'video',
          source: { kind: 'platformRef', ref: 'media-1' },
          thumbnail: { source: { kind: 'url', url: 'https://example.com/cover.jpg' } },
        },
      ],
    },
  },

  overLimitRequest: {
    request: {
      platform: 'pinterest',
      title: 'x'.repeat(101),
      type: PostType.IMAGE,
      media: [{ type: 'image', source: { kind: 'url', url: 'https://example.com/a.jpg' } }],
    },
    expectedError: /title/i,
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
