import { vi } from 'vitest';
import { ErrorCode, PostType } from '@bozonx/social-posting';
import { describePlatformContract } from '@bozonx/social-posting-conformance';
import type { ContractHarness, RecordedResponse } from '@bozonx/social-posting-conformance';
import type { ILogger, ResolvedAccountConfig } from '@bozonx/social-posting';
import { bluesky } from '../src/index.js';
import errors from './fixtures/errors.json' with { type: 'json' };

const silentLogger: ILogger = { debug: () => {}, log: () => {}, warn: () => {}, error: () => {} };

const accountConfig: ResolvedAccountConfig = {
  platform: 'bluesky',
  source: 'account',
  apiBaseUrl: 'https://pds.example',
  auth: { accessToken: 'test-token', refreshToken: 'refresh-token', did: 'did:plc:test' },
};

function createHarness(): ContractHarness {
  const originalFetch = globalThis.fetch;
  let calls = 0;

  const respond = (body: (input: RequestInfo | URL) => Response) => {
    globalThis.fetch = ((input: RequestInfo | URL) => {
      calls += 1;
      return Promise.resolve(body(input));
    }) as unknown as typeof fetch;
  };

  return {
    platform: bluesky.create({ logger: silentLogger }),
    accountConfig,

    respondSuccess() {
      respond(input => {
        const url = String(input);
        const body = url.includes('getServiceAuth')
          ? { token: 'service-token' }
          : url.includes('uploadVideo')
            ? { jobStatus: { jobId: 'job-1' } }
            : url.includes('uploadBlob')
              ? {
                  blob: {
                    $type: 'blob',
                    ref: { $link: 'cid-image' },
                    mimeType: 'image/png',
                    size: 1,
                  },
                }
              : { uri: 'at://did:plc:test/app.bsky.feed.post/1', cid: 'cid-1' };
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      });
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
  module: bluesky,
  createHarness,

  requests: {
    [PostType.POST]: {
      platform: 'bluesky',
      account: 'main',
      body: 'Contract suite post',
      type: PostType.POST,
    },
    [PostType.IMAGE]: {
      platform: 'bluesky',
      type: PostType.IMAGE,
      media: [
        {
          type: 'image',
          mimeType: 'image/png',
          source: { kind: 'bytes', bytes: new Uint8Array([1]) },
        },
      ],
    },
    [PostType.ALBUM]: {
      platform: 'bluesky',
      type: PostType.ALBUM,
      media: [
        {
          type: 'image',
          mimeType: 'image/png',
          source: { kind: 'bytes', bytes: new Uint8Array([1]) },
        },
        {
          type: 'image',
          mimeType: 'image/png',
          source: { kind: 'bytes', bytes: new Uint8Array([2]) },
        },
      ],
    },
    [PostType.VIDEO]: {
      platform: 'bluesky',
      type: PostType.VIDEO,
      media: [
        {
          type: 'video',
          mimeType: 'video/mp4',
          source: { kind: 'bytes', bytes: new Uint8Array([1]) },
        },
      ],
    },
    [PostType.SHORT_VIDEO]: {
      platform: 'bluesky',
      type: PostType.SHORT_VIDEO,
      media: [
        {
          type: 'video',
          mimeType: 'video/mp4',
          source: { kind: 'bytes', bytes: new Uint8Array([1]) },
        },
      ],
    },
  },
  overLimitRequest: {
    request: { platform: 'bluesky', type: PostType.POST, body: 'x'.repeat(301) },
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
