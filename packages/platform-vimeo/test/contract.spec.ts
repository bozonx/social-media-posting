import { vi } from 'vitest';
import { ErrorCode, PostType } from '@bozonx/social-posting';
import { describePlatformContract } from '@bozonx/social-posting-conformance';
import type {
  ContractHarness,
  RecordedResponse,
  ResumableScenario,
} from '@bozonx/social-posting-conformance';
import type { ILogger, ResolvedAccountConfig, ResumeHandle } from '@bozonx/social-posting';
import { vimeo } from '../src/index.js';
import errors from './fixtures/errors.json' with { type: 'json' };
import success from './fixtures/success.json' with { type: 'json' };

const silentLogger: ILogger = { debug: () => {}, log: () => {}, warn: () => {}, error: () => {} };

const CHUNK = 64 * 1024;
const TUS_LINK = 'https://files.tus.vimeo.com/files/contract-session';

const accountConfig: ResolvedAccountConfig = {
  platform: 'vimeo',
  source: 'account',
  accountRef: 'contract',
  auth: { accessToken: 'contract-suite-vimeo-token' },
  chunkSizeBytes: CHUNK,
};

/** A video of exactly two chunks, so an interruption has something to resume from. */
const videoBytes = new Uint8Array(CHUNK * 2).fill(3);
videoBytes.set([0, 0, 0, 24, 102, 116, 121, 112], 0);

type LocalHarness = ContractHarness & {
  install: (respond: (url: string, init?: RequestInit) => Promise<Response>) => void;
};

/** Wires the Vimeo platform to a `fetch` double fed with recorded responses. */
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

  const harness: LocalHarness = {
    platform: vimeo.create({ logger: silentLogger }),
    accountConfig,
    install,

    respondSuccess() {
      let stored = 0;
      install(async url => {
        if (url.startsWith(TUS_LINK)) {
          // The tus endpoint answers in headers and never in a body.
          stored += CHUNK;
          return new Response(null, { status: 204, headers: { 'upload-offset': String(stored) } });
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

  return harness;
}

const base = {
  platform: 'vimeo',
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

/**
 * A tus upload cut off after its first chunk, then continued.
 *
 * The resumed attempt re-reads the upload link from the video and asks the tus
 * endpoint for its offset, because the handle deliberately carries neither: the
 * link is a bearer URL and the stored offset is only what was true before the
 * process died.
 */
const resumable: ResumableScenario = {
  request: { ...base, type: PostType.VIDEO, media },
  // Re-reading the video, asking tus for its offset, and writing the one
  // missing chunk. Nothing is uploaded twice.
  completedStepsBeforeInterruption: 3,

  arrangeInterruption(harness) {
    const local = harness as LocalHarness;
    let writes = 0;
    local.install(async url => {
      if (url.startsWith(TUS_LINK)) {
        writes += 1;
        if (writes === 1) {
          return new Response(null, { status: 204, headers: { 'upload-offset': String(CHUNK) } });
        }
        return new Response(JSON.stringify({ error: 'Vimeo is temporarily unavailable.' }), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify(success.createdVideo.body), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      });
    });
  },

  arrangeResume(harness, _handle: ResumeHandle) {
    const local = harness as LocalHarness;
    local.install(async (url, init) => {
      if (url.startsWith(TUS_LINK)) {
        if (init?.method === 'HEAD') {
          return new Response(null, { status: 200, headers: { 'upload-offset': String(CHUNK) } });
        }
        return new Response(null, {
          status: 204,
          headers: { 'upload-offset': String(videoBytes.byteLength) },
        });
      }
      return new Response(JSON.stringify(success.createdVideo.body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
  },
};

describePlatformContract({
  module: vimeo,
  createHarness,

  requests: {
    [PostType.VIDEO]: { ...base, type: PostType.VIDEO, media },
    [PostType.SHORT_VIDEO]: { ...base, type: PostType.SHORT_VIDEO, media },
  },

  overLimitRequest: {
    request: { ...base, type: PostType.VIDEO, media, title: 'a'.repeat(300) },
    expectedError: /title/i,
  },

  resumable,

  errorCases: [
    {
      name: 'an account with no space left',
      response: errors.quotaExceeded as RecordedResponse,
      expect: { code: ErrorCode.QUOTA_EXCEEDED, retryable: false, httpStatus: 400 },
    },
    {
      name: 'a spent weekly upload allowance',
      response: errors.periodicQuota as RecordedResponse,
      expect: { code: ErrorCode.QUOTA_EXCEEDED, retryable: false, httpStatus: 400 },
    },
    {
      name: 'a request Vimeo asked to slow down',
      response: errors.rateLimited as RecordedResponse,
      expect: {
        code: ErrorCode.RATE_LIMIT_ERROR,
        retryable: true,
        retryAfterMs: 45_000,
        httpStatus: 429,
      },
    },
    {
      name: 'a rejected access token',
      response: errors.unauthorized as RecordedResponse,
      expect: { code: ErrorCode.AUTH_REFRESH_REQUIRED, retryable: false, httpStatus: 401 },
    },
    {
      name: 'a plan that does not allow uploading',
      response: errors.forbiddenPlan as RecordedResponse,
      expect: { code: ErrorCode.AUTH_ERROR, retryable: false, httpStatus: 403 },
    },
    {
      name: 'metadata Vimeo refuses',
      response: errors.unprocessable as RecordedResponse,
      expect: { code: ErrorCode.CONTENT_REJECTED, retryable: false, httpStatus: 422 },
    },
    {
      name: 'an unknown resource',
      response: errors.notFound as RecordedResponse,
      expect: { code: ErrorCode.VALIDATION_ERROR, retryable: false, httpStatus: 404 },
    },
    {
      name: 'a Vimeo outage',
      response: errors.serverError as RecordedResponse,
      expect: { code: ErrorCode.PLATFORM_ERROR, retryable: true, httpStatus: 503 },
    },
  ],
});
