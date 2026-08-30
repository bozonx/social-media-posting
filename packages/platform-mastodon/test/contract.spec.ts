import { vi } from 'vitest';
import {
  ErrorCode,
  PostType,
  type ILogger,
  type ResolvedAccountConfig,
} from '@bozonx/social-posting';
import {
  describePlatformContract,
  type ContractHarness,
  type RecordedResponse,
} from '@bozonx/social-posting-conformance';
import { mastodon } from '../src/index.js';

const logger: ILogger = { debug() {}, log() {}, warn() {}, error() {} };
const accountConfig: ResolvedAccountConfig = {
  platform: 'mastodon',
  source: 'account',
  apiBaseUrl: 'https://social.example',
  auth: { accessToken: 'test' },
};
const image = {
  type: 'image' as const,
  source: { kind: 'platformRef' as const, ref: 'media-image' },
};
const video = {
  type: 'video' as const,
  source: { kind: 'platformRef' as const, ref: 'media-video' },
};
const audio = {
  type: 'audio' as const,
  source: { kind: 'platformRef' as const, ref: 'media-audio' },
};

function createHarness(): ContractHarness {
  let calls = 0;
  let response = () =>
    new Response(JSON.stringify({ id: 'status-1', url: 'https://social.example/@a/status-1' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  const original = globalThis.fetch;
  globalThis.fetch = (() => {
    calls += 1;
    return Promise.resolve(response());
  }) as typeof fetch;
  return {
    platform: mastodon.create({ logger }),
    accountConfig,
    respondSuccess() {
      response = () =>
        new Response(
          JSON.stringify({ id: 'status-1', url: 'https://social.example/@a/status-1' }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
    },
    respondWith(recorded: RecordedResponse) {
      response = () =>
        new Response(JSON.stringify(recorded.body ?? {}), {
          status: recorded.status,
          headers: { 'content-type': 'application/json', ...recorded.headers },
        });
    },
    respondNever() {
      globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
        calls += 1;
        return new Promise((_resolve, reject) =>
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          ),
        );
      }) as typeof fetch;
    },
    callCount: () => calls,
    restore() {
      globalThis.fetch = original;
      vi.restoreAllMocks();
    },
  };
}

describePlatformContract({
  module: mastodon,
  createHarness,
  requests: {
    [PostType.POST]: { platform: 'mastodon', type: PostType.POST, body: 'hello' },
    [PostType.IMAGE]: { platform: 'mastodon', type: PostType.IMAGE, body: 'image', media: [image] },
    [PostType.VIDEO]: { platform: 'mastodon', type: PostType.VIDEO, body: 'video', media: [video] },
    [PostType.AUDIO]: { platform: 'mastodon', type: PostType.AUDIO, body: 'audio', media: [audio] },
    [PostType.ALBUM]: {
      platform: 'mastodon',
      type: PostType.ALBUM,
      media: [image, { ...image, source: { kind: 'platformRef', ref: 'media-2' } }],
    },
    [PostType.POLL]: {
      platform: 'mastodon',
      type: PostType.POLL,
      body: 'choose',
      poll: { options: ['a', 'b'], durationSecs: 300 },
    },
  },
  overLimitRequest: {
    request: { platform: 'mastodon', type: PostType.POST, body: 'x'.repeat(501) },
    expectedError: /body/i,
  },
  errorCases: [
    {
      name: 'rate limit',
      response: { status: 429, headers: { 'retry-after': '2' }, body: { error: 'slow down' } },
      expect: {
        code: ErrorCode.RATE_LIMIT_ERROR,
        retryable: true,
        retryAfterMs: 2000,
        httpStatus: 429,
      },
    },
    {
      name: 'expired token',
      response: { status: 401, body: { error: 'unauthorized' } },
      expect: { code: ErrorCode.AUTH_REFRESH_REQUIRED, retryable: false, httpStatus: 401 },
    },
    {
      name: 'outage',
      response: { status: 503, body: { error: 'down' } },
      expect: { code: ErrorCode.PLATFORM_ERROR, retryable: true, httpStatus: 503 },
    },
  ],
});
