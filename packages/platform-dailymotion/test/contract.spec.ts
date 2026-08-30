import { vi } from 'vitest';
import { ErrorCode, PostType } from '@bozonx/social-posting';
import { describePlatformContract } from '@bozonx/social-posting-conformance';
import type { ContractHarness, RecordedResponse } from '@bozonx/social-posting-conformance';
import type { ILogger, ResolvedAccountConfig } from '@bozonx/social-posting';
import { dailymotion } from '../src/index.js';
import errors from './fixtures/errors.json' with { type: 'json' };
import success from './fixtures/success.json' with { type: 'json' };

const silentLogger: ILogger = { debug: () => {}, log: () => {}, warn: () => {}, error: () => {} };

const accountConfig: ResolvedAccountConfig = {
  platform: 'dailymotion',
  source: 'account',
  accountRef: 'contract',
  auth: { accessToken: 'contract-suite-dailymotion-token' },
};

const videoBytes = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109]);

/** Wires the Dailymotion platform to a `fetch` double fed with recorded responses. */
function createHarness(): ContractHarness {
  const originalFetch = globalThis.fetch;
  let calls = 0;

  const install = (respond: (url: string, init?: RequestInit) => Promise<Response>) => {
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      calls += 1;
      return respond(String(input), init);
    }) as unknown as typeof fetch;
  };

  const responseFrom = (recorded: RecordedResponse): Response =>
    new Response(recorded.status === 204 ? null : JSON.stringify(recorded.body ?? {}), {
      status: recorded.status,
      headers: { 'content-type': 'application/json', ...recorded.headers },
    });

  return {
    platform: dailymotion.create({ logger: silentLogger }),
    accountConfig,

    respondSuccess() {
      install(async url => {
        if (url.includes('/file/upload')) {
          return responseFrom(success.uploadTicket as RecordedResponse);
        }
        if (url.includes('upload-01.dailymotion.com')) {
          return responseFrom(success.uploadedFile as RecordedResponse);
        }
        return responseFrom(success.createdVideo as RecordedResponse);
      });
    },

    respondWith(recorded: RecordedResponse) {
      install(async () => responseFrom(recorded));
    },

    respondNever() {
      globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
        calls += 1;
        if (init?.signal?.aborted) {
          return Promise.reject(new DOMException('The operation was aborted.', 'AbortError'));
        }
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

const base = {
  platform: 'dailymotion',
  account: 'contract',
  title: 'Contract suite video',
  body: 'Uploaded by the contract suite.',
};

const media = [
  {
    type: 'video' as const,
    mimeType: 'video/mp4',
    fileName: 'contract.mp4',
    source: { kind: 'bytes' as const, bytes: videoBytes },
  },
];

describePlatformContract({
  module: dailymotion,
  createHarness,

  requests: {
    [PostType.VIDEO]: { ...base, type: PostType.VIDEO, media },
  },

  overLimitRequest: {
    request: { ...base, type: PostType.VIDEO, media, title: 'a'.repeat(400) },
    expectedError: /title/i,
  },

  errorCases: [
    {
      name: 'a spent daily upload allowance',
      response: errors.limitReached as RecordedResponse,
      expect: { code: ErrorCode.QUOTA_EXCEEDED, retryable: true, httpStatus: 400 },
    },
    {
      name: 'a request Dailymotion asked to slow down',
      response: errors.rateLimited as RecordedResponse,
      expect: {
        code: ErrorCode.RATE_LIMIT_ERROR,
        retryable: true,
        retryAfterMs: 60_000,
        httpStatus: 429,
      },
    },
    {
      name: 'an expired access token',
      response: errors.unauthorized as RecordedResponse,
      expect: { code: ErrorCode.AUTH_REFRESH_REQUIRED, retryable: false, httpStatus: 401 },
    },
    {
      name: 'an account not allowed to upload',
      response: errors.forbiddenAccount as RecordedResponse,
      expect: { code: ErrorCode.AUTH_ERROR, retryable: false, httpStatus: 403 },
    },
    {
      name: 'metadata Dailymotion refuses',
      response: errors.invalidParameter as RecordedResponse,
      expect: { code: ErrorCode.CONTENT_REJECTED, retryable: false, httpStatus: 400 },
    },
    {
      name: 'a Dailymotion outage',
      response: errors.serverError as RecordedResponse,
      expect: { code: ErrorCode.PLATFORM_ERROR, retryable: true, httpStatus: 500 },
    },
  ],
});
