import { vi } from 'vitest';
import { ErrorCode, PostType } from '@bozonx/social-posting';
import { describePlatformContract } from '@bozonx/social-posting-conformance';
import type {
  ContractHarness,
  RecordedResponse,
  ResumableScenario,
} from '@bozonx/social-posting-conformance';
import type { ILogger, ResolvedAccountConfig, ResumeHandle } from '@bozonx/social-posting';
import { youtube } from '../src/index.js';
import errors from './fixtures/errors.json' with { type: 'json' };
import success from './fixtures/success.json' with { type: 'json' };

const silentLogger: ILogger = { debug: () => {}, log: () => {}, warn: () => {}, error: () => {} };

/** The smallest chunk Google's protocol allows, so a test file spans two of them. */
const CHUNK = 256 * 1024;
const SESSION_URL =
  'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=contract-session';

const accountConfig: ResolvedAccountConfig = {
  platform: 'youtube',
  source: 'account',
  accountRef: 'contract',
  auth: { accessToken: 'ya29.contract-suite-access-token' },
  chunkSizeBytes: CHUNK,
};

/** A video of exactly two chunks, so an interruption has something to resume from. */
const videoBytes = new Uint8Array(CHUNK * 2).fill(7);
videoBytes.set([0, 0, 0, 24, 102, 116, 121, 112], 0);

/** Wires the YouTube platform to a `fetch` double fed with recorded responses. */
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

  /** 308 is not an error here: it is "chunk stored, send the next one". */
  const resumeIncomplete = (upTo: number): Response =>
    new Response(null, { status: 308, headers: { range: `bytes=0-${upTo - 1}` } });

  const harness: ContractHarness & {
    install: typeof install;
    resumeIncomplete: typeof resumeIncomplete;
  } = {
    platform: youtube.create({ logger: silentLogger }),
    accountConfig,
    install,
    resumeIncomplete,

    respondSuccess() {
      let sent = 0;
      install(async url => {
        if (url.includes('/upload/youtube/v3/videos') && !url.includes('upload_id')) {
          // Session initiation: the useful part is the Location header.
          return new Response(null, { status: 200, headers: { location: SESSION_URL } });
        }
        if (url.startsWith(SESSION_URL)) {
          sent += CHUNK;
          return sent >= videoBytes.byteLength
            ? responseFrom(success.insertedVideo as RecordedResponse)
            : resumeIncomplete(sent);
        }
        if (url.includes('/thumbnails/set')) {
          return responseFrom({ status: 200, body: {} });
        }
        return responseFrom(success.insertedVideo as RecordedResponse);
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
  platform: 'youtube',
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
 * An upload cut off after its first chunk, then continued.
 *
 * The point of the scenario is the second `publish()`: it must ask YouTube
 * where the file got to and send only what is missing. Re-uploading from zero
 * would work too — and would silently double the bandwidth bill for every
 * interrupted upload of a large video.
 */
const resumable: ResumableScenario = {
  request: { ...base, type: PostType.VIDEO, media },
  // Session initiation plus the first stored chunk: a resumed attempt gets to
  // spend a position query and the remaining chunk, and nothing more.
  completedStepsBeforeInterruption: 2,

  arrangeInterruption(harness) {
    const local = harness as ContractHarness & {
      install: (respond: (url: string) => Promise<Response>) => void;
      resumeIncomplete: (upTo: number) => Response;
    };
    let chunks = 0;
    local.install(async url => {
      if (url.includes('/upload/youtube/v3/videos') && !url.includes('upload_id')) {
        return new Response(null, { status: 200, headers: { location: SESSION_URL } });
      }
      chunks += 1;
      if (chunks === 1) {
        return local.resumeIncomplete(CHUNK);
      }
      return new Response(JSON.stringify({ error: { code: 503, message: 'backend error' } }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      });
    });
  },

  arrangeResume(harness, _handle: ResumeHandle) {
    const local = harness as ContractHarness & {
      install: (respond: (url: string, init?: RequestInit) => Promise<Response>) => void;
      resumeIncomplete: (upTo: number) => Response;
    };
    local.install(async (url, init) => {
      const range = new Headers(init?.headers).get('content-range');
      if (range === `bytes */${videoBytes.byteLength}`) {
        // The position query: YouTube confirms it holds the first chunk.
        return local.resumeIncomplete(CHUNK);
      }
      if (url.startsWith(SESSION_URL)) {
        return new Response(JSON.stringify(success.insertedVideo.body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(null, { status: 200, headers: { location: SESSION_URL } });
    });
  },
};

describePlatformContract({
  module: youtube,
  createHarness,

  requests: {
    [PostType.VIDEO]: { ...base, type: PostType.VIDEO, media },
    [PostType.SHORT_VIDEO]: {
      ...base,
      type: PostType.SHORT_VIDEO,
      media: [{ ...media[0]!, width: 1080, height: 1920 }],
    },
  },

  overLimitRequest: {
    request: { ...base, type: PostType.VIDEO, media, title: 'a'.repeat(200) },
    expectedError: /title/i,
  },

  resumable,

  unknownOutcome: {
    request: { ...base, type: PostType.VIDEO, media },
    arrangeAmbiguousCreate(harness) {
      const local = harness as ContractHarness & {
        install: (respond: (url: string) => Promise<Response>) => void;
        resumeIncomplete: (upTo: number) => Response;
      };
      let sent = 0;
      local.install(async url => {
        if (url.includes('/upload/youtube/v3/videos') && !url.includes('upload_id')) {
          return new Response(null, { status: 200, headers: { location: SESSION_URL } });
        }
        // Every chunk lands, and YouTube never says whether a video was made.
        sent += CHUNK;
        return local.resumeIncomplete(sent);
      });
    },
  },

  errorCases: [
    {
      name: 'a spent daily quota',
      response: errors.quotaExceeded as RecordedResponse,
      expect: { code: ErrorCode.QUOTA_EXCEEDED, retryable: true, httpStatus: 403 },
    },
    {
      name: 'a request YouTube asked to slow down',
      response: errors.rateLimited as RecordedResponse,
      expect: {
        code: ErrorCode.RATE_LIMIT_ERROR,
        retryable: true,
        retryAfterMs: 30_000,
        httpStatus: 429,
      },
    },
    {
      name: 'an expired access token',
      response: errors.unauthorized as RecordedResponse,
      expect: { code: ErrorCode.AUTH_REFRESH_REQUIRED, retryable: false, httpStatus: 401 },
    },
    {
      name: 'a channel not allowed to upload',
      response: errors.forbiddenChannel as RecordedResponse,
      expect: { code: ErrorCode.AUTH_ERROR, retryable: false, httpStatus: 403 },
    },
    {
      name: 'metadata YouTube refuses',
      response: errors.invalidTitle as RecordedResponse,
      expect: { code: ErrorCode.CONTENT_REJECTED, retryable: false, httpStatus: 400 },
    },
    {
      name: 'an unknown resource',
      response: errors.notFound as RecordedResponse,
      expect: { code: ErrorCode.VALIDATION_ERROR, retryable: false, httpStatus: 404 },
    },
    {
      name: 'a YouTube outage',
      response: errors.serverError as RecordedResponse,
      expect: { code: ErrorCode.PLATFORM_ERROR, retryable: true, httpStatus: 503 },
    },
  ],
});
