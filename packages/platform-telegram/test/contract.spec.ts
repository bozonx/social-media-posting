import { vi } from 'vitest';
import { ErrorCode, PostType } from '@bozonx/social-posting';
import { describePlatformContract } from '@bozonx/social-posting-conformance';
import type { ContractHarness, RecordedResponse } from '@bozonx/social-posting-conformance';
import type { ILogger, ResolvedAccountConfig } from '@bozonx/social-posting';
import { telegram } from '../src/index.js';
import errors from './fixtures/errors.json' with { type: 'json' };
import success from './fixtures/success.json' with { type: 'json' };

const silentLogger: ILogger = { debug: () => {}, log: () => {}, warn: () => {}, error: () => {} };

const accountConfig: ResolvedAccountConfig = {
  platform: 'telegram',
  source: 'account',
  auth: { apiKey: '123456789:ABC-DEF1234ghIkl-zyx57W2v1u123ew11' },
  target: { id: '@contract_channel' },
};

/**
 * Wires the Telegram platform to a `fetch` double, so the suite can hand it
 * recorded Bot API responses without knowing any Bot API URLs.
 */
function createHarness(): ContractHarness {
  const originalFetch = globalThis.fetch;
  let calls = 0;

  const install = (respond: (url: string) => Promise<Response>) => {
    globalThis.fetch = ((input: RequestInfo | URL) => {
      calls += 1;
      return respond(String(input));
    }) as unknown as typeof fetch;
  };

  const responseFrom = (recorded: RecordedResponse): Response =>
    new Response(JSON.stringify(recorded.body ?? {}), {
      status: recorded.status,
      headers: { 'content-type': 'application/json', ...recorded.headers },
    });

  return {
    platform: telegram.create({ logger: silentLogger }),
    accountConfig,

    respondSuccess() {
      install(async url => {
        if (url.endsWith('deleteMessage')) {
          return new Response(JSON.stringify({ ok: true, result: true }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        return responseFrom(
          url.endsWith('sendMediaGroup')
            ? (success.sendMediaGroup as RecordedResponse)
            : (success.sendMessage as RecordedResponse),
        );
      });
    },

    respondWith(recorded: RecordedResponse) {
      install(async () => responseFrom(recorded));
    },

    respondNever() {
      // Real `fetch` rejects when its signal aborts; a double that ignored the
      // signal would let a platform pass this test without honouring it.
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

const base = {
  platform: 'telegram',
  account: 'contract',
  target: { id: '@contract_channel' },
};

describePlatformContract({
  module: telegram,
  createHarness,

  sampleDeleteRef: { postId: '12345' },

  requests: {
    [PostType.POST]: { ...base, body: 'Contract suite post', type: PostType.POST },
    [PostType.IMAGE]: {
      ...base,
      type: PostType.IMAGE,
      body: 'caption',
      media: [{ source: { kind: 'url', url: 'https://cdn.example.com/image.jpg' } }],
    },
    [PostType.VIDEO]: {
      ...base,
      type: PostType.VIDEO,
      media: [{ source: { kind: 'url', url: 'https://cdn.example.com/video.mp4' } }],
    },
    [PostType.AUDIO]: {
      ...base,
      type: PostType.AUDIO,
      media: [{ source: { kind: 'url', url: 'https://cdn.example.com/audio.mp3' } }],
    },
    [PostType.DOCUMENT]: {
      ...base,
      type: PostType.DOCUMENT,
      media: [{ source: { kind: 'url', url: 'https://cdn.example.com/report.pdf' } }],
    },
    [PostType.ALBUM]: {
      ...base,
      type: PostType.ALBUM,
      media: [
        { source: { kind: 'url', url: 'https://cdn.example.com/1.jpg' } },
        { source: { kind: 'url', url: 'https://cdn.example.com/2.jpg' } },
      ],
    },
    [PostType.POLL]: {
      ...base,
      type: PostType.POLL,
      body: 'Contract poll question',
      poll: { options: ['Option A', 'Option B'] },
    },
  },

  overLimitRequest: {
    request: { ...base, body: 'a'.repeat(5000), type: PostType.POST },
    expectedError: /exceeds the 4096 characters/,
  },

  errorCases: [
    {
      name: 'a 429 with retry_after',
      response: errors.rateLimited as RecordedResponse,
      expect: {
        code: ErrorCode.RATE_LIMIT_ERROR,
        retryable: true,
        retryAfterMs: 30_000,
        httpStatus: 429,
      },
    },
    {
      name: 'a rejected bot token',
      response: errors.unauthorized as RecordedResponse,
      expect: { code: ErrorCode.AUTH_ERROR, retryable: false, httpStatus: 401 },
    },
    {
      name: 'a bot blocked by the user',
      response: errors.botBlocked as RecordedResponse,
      expect: { code: ErrorCode.AUTH_ERROR, retryable: false, httpStatus: 403 },
    },
    {
      name: 'an unknown chat',
      response: errors.chatNotFound as RecordedResponse,
      expect: { code: ErrorCode.VALIDATION_ERROR, retryable: false, httpStatus: 400 },
    },
    {
      name: 'media refused by Telegram',
      response: errors.mediaRejected as RecordedResponse,
      expect: { code: ErrorCode.CONTENT_REJECTED, retryable: false, httpStatus: 400 },
    },
    {
      name: 'a Bot API outage',
      response: errors.serverError as RecordedResponse,
      expect: { code: ErrorCode.PLATFORM_ERROR, retryable: true, httpStatus: 502 },
    },
  ],
});
