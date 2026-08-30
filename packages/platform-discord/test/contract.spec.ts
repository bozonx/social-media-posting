import { vi } from 'vitest';
import { ErrorCode, PostType } from '@bozonx/social-posting';
import { describePlatformContract } from '@bozonx/social-posting-conformance';
import type { ContractHarness, RecordedResponse } from '@bozonx/social-posting-conformance';
import type { ILogger, ResolvedAccountConfig } from '@bozonx/social-posting';
import { discord } from '../src/index.js';
import errors from './fixtures/errors.json' with { type: 'json' };
import success from './fixtures/success.json' with { type: 'json' };

const silentLogger: ILogger = { debug: () => {}, log: () => {}, warn: () => {}, error: () => {} };

/**
 * A bot-token account: it exercises the composite target and the routes a
 * webhook cannot reach (replies, deletion by channel).
 */
const accountConfig: ResolvedAccountConfig = {
  platform: 'discord',
  source: 'account',
  auth: { botToken: 'MTI5MDAwMDAwMDAwMDAwMDAw.GaBcDe.contract-suite-bot-token-value' },
  target: { id: '1290000000000000002', guildId: '1280000000000000003' },
};

/** Wires the Discord platform to a `fetch` double fed with recorded responses. */
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
    new Response(recorded.status === 204 ? null : JSON.stringify(recorded.body ?? {}), {
      status: recorded.status,
      headers: { 'content-type': 'application/json', ...recorded.headers },
    });

  return {
    platform: discord.create({ logger: silentLogger }),
    accountConfig,

    respondSuccess() {
      install(async url => {
        if (url.includes('/media/')) {
          // Media the adapter downloads before pushing it to Discord.
          return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), {
            status: 200,
            headers: { 'content-type': 'image/jpeg', 'content-length': '6' },
          });
        }
        return responseFrom(success.botMessage as RecordedResponse);
      });
    },

    respondWith(recorded: RecordedResponse) {
      install(async () => responseFrom(recorded));
    },

    respondNever() {
      // The real `fetch` rejects when its signal aborts; a double that ignored
      // the signal would let the platform pass without honouring it.
      globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
        calls += 1;
        // A real `fetch` rejects an already-aborted signal rather than waiting
        // for an `abort` event that has already fired.
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
  platform: 'discord',
  account: 'contract',
  target: { id: '1290000000000000002', guildId: '1280000000000000003' },
};

const image = { source: { kind: 'url' as const, url: 'https://cdn.example.com/media/1.jpg' } };

describePlatformContract({
  module: discord,
  createHarness,

  sampleDeleteRef: { postId: '1310000000000000001' },

  requests: {
    [PostType.POST]: { ...base, type: PostType.POST, body: 'Contract suite post' },
    [PostType.IMAGE]: { ...base, type: PostType.IMAGE, body: 'caption', media: [image] },
    [PostType.VIDEO]: {
      ...base,
      type: PostType.VIDEO,
      media: [
        {
          type: 'video' as const,
          mimeType: 'video/mp4',
          source: {
            kind: 'bytes' as const,
            bytes: new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]),
          },
        },
      ],
    },
    [PostType.AUDIO]: {
      ...base,
      type: PostType.AUDIO,
      media: [
        {
          type: 'audio' as const,
          mimeType: 'audio/mpeg',
          fileName: 'track.mp3',
          source: { kind: 'bytes' as const, bytes: new Uint8Array([0x49, 0x44, 0x33, 0x04]) },
        },
      ],
    },
    [PostType.DOCUMENT]: {
      ...base,
      type: PostType.DOCUMENT,
      media: [
        {
          type: 'document' as const,
          mimeType: 'application/pdf',
          fileName: 'report.pdf',
          source: { kind: 'bytes' as const, bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]) },
        },
      ],
    },
    [PostType.ALBUM]: { ...base, type: PostType.ALBUM, media: [image, image] },
    [PostType.POLL]: {
      ...base,
      type: PostType.POLL,
      title: 'Contract poll question',
      poll: { options: ['Option A', 'Option B'], durationSecs: 3600 },
    },
  },

  overLimitRequest: {
    request: { ...base, type: PostType.POST, body: 'a'.repeat(2_500) },
    expectedError: /exceeds the 2000 characters/,
  },

  errorCases: [
    {
      name: 'a 429 with its cool-down',
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
      name: 'a bot without permission in the channel',
      response: errors.missingPermissions as RecordedResponse,
      expect: { code: ErrorCode.AUTH_ERROR, retryable: false, httpStatus: 403 },
    },
    {
      name: 'an unknown channel',
      response: errors.unknownChannel as RecordedResponse,
      expect: { code: ErrorCode.VALIDATION_ERROR, retryable: false, httpStatus: 404 },
    },
    {
      name: 'an attachment Discord refuses',
      response: errors.attachmentTooLarge as RecordedResponse,
      expect: { code: ErrorCode.CONTENT_REJECTED, retryable: false, httpStatus: 400 },
    },
    {
      name: 'a body over the request size limit',
      response: errors.payloadTooLarge as RecordedResponse,
      expect: { code: ErrorCode.CONTENT_REJECTED, retryable: false, httpStatus: 413 },
    },
    {
      name: 'a Discord outage',
      response: errors.serverError as RecordedResponse,
      expect: { code: ErrorCode.PLATFORM_ERROR, retryable: true, httpStatus: 503 },
    },
  ],
});
