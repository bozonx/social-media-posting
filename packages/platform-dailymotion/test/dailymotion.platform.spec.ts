import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorCode, PostType } from '@bozonx/social-posting';
import type {
  ILogger,
  PostRequest,
  ResolvedAccountConfig,
  ResumeHandle,
} from '@bozonx/social-posting';
import { DailymotionPlatform, PROCESSING_STEP } from '../src/dailymotion.platform.js';
import success from './fixtures/success.json' with { type: 'json' };

const silentLogger: ILogger = { debug: () => {}, log: () => {}, warn: () => {}, error: () => {} };

const account: ResolvedAccountConfig = {
  platform: 'dailymotion',
  source: 'account',
  accountRef: 'channel-1',
  auth: { accessToken: 'dm-token' },
};

const videoBytes = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109]);

function request(overrides: Partial<PostRequest> = {}): PostRequest {
  return {
    platform: 'dailymotion',
    account: 'channel-1',
    type: PostType.VIDEO,
    title: 'A video',
    body: 'Its description',
    media: [{ type: 'video', mimeType: 'video/mp4', source: { kind: 'bytes', bytes: videoBytes } }],
    ...overrides,
  };
}

function stubFetch(respond: (url: string, init: RequestInit) => Response) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  globalThis.fetch = ((input: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({ url: String(input), init });
    return Promise.resolve(respond(String(input), init));
  }) as unknown as typeof fetch;
  return calls;
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function respondToUpload(url: string): Response {
  if (url.includes('/file/upload')) {
    return json(success.uploadTicket.body);
  }
  if (url.includes('upload-01.dailymotion.com')) {
    return json(success.uploadedFile.body);
  }
  return json(success.createdVideo.body);
}

describe('DailymotionPlatform.publish', () => {
  it('runs the three steps in order and reports processing', async () => {
    const calls = stubFetch(respondToUpload);
    const platform = new DailymotionPlatform({ logger: silentLogger });

    const result = await platform.publish(request(), account);

    expect(calls.map(call => call.url)).toEqual([
      'https://api.dailymotion.com/file/upload',
      'https://upload-01.dailymotion.com/upload?uuid=contract&seal=abc',
      'https://api.dailymotion.com/me/videos',
    ]);
    expect(result.status).toBe('processing');
    expect(result.postId).toBe('x8abcde');
    expect(result.handle?.step).toBe(PROCESSING_STEP);
  });

  it('keeps the video private unless the request asks for public', async () => {
    const calls = stubFetch(respondToUpload);
    const platform = new DailymotionPlatform({ logger: silentLogger });

    await platform.publish(request(), account);
    const priv = new URLSearchParams(String(calls[2]?.init.body));
    expect(priv.get('published')).toBe('false');
    expect(priv.get('description')).toBe('Its description');

    await platform.publish(request({ visibility: 'public' }), account);
    const pub = new URLSearchParams(String(calls[5]?.init.body));
    expect(pub.get('published')).toBe('true');
  });

  it('issues no resume handle for the upload, because the upload cannot be resumed', async () => {
    stubFetch(url => {
      if (url.includes('/file/upload')) {
        return json(success.uploadTicket.body);
      }
      return json({ error: { code: 500, message: 'gone' } }, 500);
    });
    const platform = new DailymotionPlatform({ logger: silentLogger });

    const error = (await platform.publish(request(), account).catch(t => t)) as {
      resumeHandle?: ResumeHandle;
      code?: string;
    };

    // A handle that cannot actually resume is worse than none: the host would
    // keep progress it can never continue from.
    expect(error.resumeHandle).toBeUndefined();
    expect(error.code).toBe(ErrorCode.PLATFORM_ERROR);
  });

  it('refuses a scheduled publish rather than dropping the time silently', async () => {
    const calls = stubFetch(respondToUpload);
    const platform = new DailymotionPlatform({ logger: silentLogger });

    await expect(
      platform.publish(request({ scheduledAt: '2026-09-01T10:00:00Z' }), account),
    ).rejects.toThrow(/no publish-later endpoint/);
    expect(calls).toHaveLength(0);
  });
});

describe('DailymotionPlatform.checkStatus', () => {
  const handle: ResumeHandle = {
    version: 1,
    platform: 'dailymotion',
    step: PROCESSING_STEP,
    state: { videoId: 'x8abcde' },
  };

  it('stays processing while encoding runs', async () => {
    stubFetch(() => json(success.processing.body));
    const platform = new DailymotionPlatform({ logger: silentLogger });

    const result = await platform.checkStatus(handle, account);

    expect(result.status).toBe('processing');
  });

  it('publishes once the status says published', async () => {
    stubFetch(() => json(success.published.body));
    const platform = new DailymotionPlatform({ logger: silentLogger });

    const result = await platform.checkStatus(handle, account);

    expect(result.status).toBe('published');
    expect(result.url).toBe('https://www.dailymotion.com/video/x8abcde');
  });

  it('reports an encoding error as content Dailymotion refused', async () => {
    stubFetch(() => json(success.encodingError.body));
    const platform = new DailymotionPlatform({ logger: silentLogger });

    const result = await platform.checkStatus(handle, account);

    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe(ErrorCode.CONTENT_REJECTED);
  });
});
