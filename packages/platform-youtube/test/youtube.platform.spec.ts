import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorCode, PostType, findResumeHandleSecrets } from '@bozonx/social-posting';
import type {
  ILogger,
  PostRequest,
  ResolvedAccountConfig,
  ResumeHandle,
} from '@bozonx/social-posting';
import { YouTubePlatform, PROCESSING_STEP } from '../src/youtube.platform.js';
import success from './fixtures/success.json' with { type: 'json' };

const silentLogger: ILogger = { debug: () => {}, log: () => {}, warn: () => {}, error: () => {} };

const CHUNK = 256 * 1024;
const SESSION_URL =
  'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=session-42';

const account: ResolvedAccountConfig = {
  platform: 'youtube',
  source: 'account',
  accountRef: 'channel-1',
  auth: { accessToken: 'ya29.token' },
  chunkSizeBytes: CHUNK,
};

const videoBytes = new Uint8Array(CHUNK).fill(1);

function request(overrides: Partial<PostRequest> = {}): PostRequest {
  return {
    platform: 'youtube',
    account: 'channel-1',
    type: PostType.VIDEO,
    title: 'A video',
    body: 'Its description',
    media: [
      {
        type: 'video',
        mimeType: 'video/mp4',
        source: { kind: 'bytes', bytes: videoBytes },
      },
    ],
    ...overrides,
  };
}

/** Records every call so a test can assert on what was actually sent. */
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

/** The happy path: metadata, one chunk, and a video that is not yet watchable. */
function respondToUpload(url: string): Response {
  if (url.includes('/upload/youtube/v3/videos') && !url.includes('upload_id')) {
    return new Response(null, { status: 200, headers: { location: SESSION_URL } });
  }
  return new Response(JSON.stringify(success.insertedVideo.body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('YouTubePlatform.publish', () => {
  it('reports processing rather than published, because an uploaded video is not a watchable one', async () => {
    stubFetch(respondToUpload);
    const platform = new YouTubePlatform({ logger: silentLogger });

    const result = await platform.publish(request(), account);

    expect(result.status).toBe('processing');
    expect(result.postId).toBe('dQw4w9WgXcQ');
    expect(result.url).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(result.handle?.step).toBe(PROCESSING_STEP);
    expect(result.handle?.state.videoId).toBe('dQw4w9WgXcQ');
  });

  it('keeps the upload session out of the resume handle, which the host stores', async () => {
    stubFetch(url => {
      if (url.includes('/upload/youtube/v3/videos') && !url.includes('upload_id')) {
        return new Response(null, { status: 200, headers: { location: SESSION_URL } });
      }
      return new Response(JSON.stringify({ error: { code: 503, message: 'nope' } }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      });
    });
    const platform = new YouTubePlatform({ logger: silentLogger });

    const error = await platform.publish(request(), account).catch((thrown: unknown) => thrown);

    const handle = (error as { resumeHandle?: ResumeHandle }).resumeHandle;
    expect(handle).toBeDefined();
    expect(findResumeHandleSecrets(handle as ResumeHandle)).toEqual([]);
    expect(JSON.stringify(handle)).not.toContain('ya29.token');
    // The session is addressed by its opaque id, never by the signed URL.
    expect(handle?.state.uploadId).toBe('session-42');
  });

  it('sends the body as the description and the account default as the category', async () => {
    const calls = stubFetch(respondToUpload);
    const platform = new YouTubePlatform({ logger: silentLogger });

    await platform.publish(request(), { ...account, defaultCategoryId: '28' });

    const init = calls[0]?.init;
    const metadata = JSON.parse(String(init?.body)) as {
      snippet: { description: string; categoryId: string; title: string };
      status: { privacyStatus: string };
    };
    expect(metadata.snippet.description).toBe('Its description');
    expect(metadata.snippet.categoryId).toBe('28');
    // Private by default: a mis-wired host must not publish to the world by
    // omission.
    expect(metadata.status.privacyStatus).toBe('private');
  });

  it('refuses a chunk size YouTube would reject, before opening a session', async () => {
    const calls = stubFetch(respondToUpload);
    const platform = new YouTubePlatform({ logger: silentLogger });

    await expect(platform.publish(request(), { ...account, chunkSizeBytes: 1000 })).rejects.toThrow(
      /multiple of 262144/,
    );
    expect(calls).toHaveLength(0);
  });

  it('refuses a scheduled publish on a video that is not private', async () => {
    const calls = stubFetch(respondToUpload);
    const platform = new YouTubePlatform({ logger: silentLogger });

    await expect(
      platform.publish(
        request({ visibility: 'public', scheduledAt: '2026-09-01T10:00:00Z' }),
        account,
      ),
    ).rejects.toThrow(/private/);
    expect(calls).toHaveLength(0);
  });

  it('does not let a refused thumbnail undo an upload that already cost its quota', async () => {
    const warn = vi.fn();
    stubFetch(url => {
      if (url.includes('/thumbnails/set')) {
        return new Response(JSON.stringify({ error: { code: 400, message: 'too big' } }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        });
      }
      return respondToUpload(url);
    });
    const platform = new YouTubePlatform({ logger: { ...silentLogger, warn } });

    const result = await platform.publish(
      request({
        thumbnail: {
          mimeType: 'image/jpeg',
          source: { kind: 'bytes', bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]) },
        },
      }),
      account,
    );

    expect(result.status).toBe('processing');
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('thumbnail was refused'),
      expect.anything(),
    );
  });
});

describe('YouTubePlatform.checkStatus', () => {
  const handle: ResumeHandle = {
    version: 1,
    platform: 'youtube',
    step: PROCESSING_STEP,
    state: { videoId: 'dQw4w9WgXcQ' },
  };

  it('stays processing while YouTube is still transcoding', async () => {
    stubFetch(
      () =>
        new Response(JSON.stringify(success.processing.body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    const platform = new YouTubePlatform({ logger: silentLogger });

    const result = await platform.checkStatus(handle, account);

    expect(result.status).toBe('processing');
    // YouTube's own estimate is honoured, but never below the descriptor's
    // interval: an optimistic estimate is not a reason to spend more quota.
    expect(result.checkAfterMs).toBe(120_000);
  });

  it('publishes only once processingDetails says so, not when uploadStatus does', async () => {
    stubFetch(
      () =>
        new Response(JSON.stringify(success.succeeded.body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    const platform = new YouTubePlatform({ logger: silentLogger });

    const result = await platform.checkStatus(handle, account);

    expect(result.status).toBe('published');
    expect(result.url).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  });

  it('reports a failed transcode as content YouTube refused', async () => {
    stubFetch(
      () =>
        new Response(JSON.stringify(success.processingFailed.body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    const platform = new YouTubePlatform({ logger: silentLogger });

    const result = await platform.checkStatus(handle, account);

    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe(ErrorCode.CONTENT_REJECTED);
    expect(result.error?.message).toContain('transcodeFailed');
  });

  it('treats a video that has vanished as removed rather than as still processing', async () => {
    stubFetch(
      () =>
        new Response(JSON.stringify(success.emptyList.body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    const platform = new YouTubePlatform({ logger: silentLogger });

    const result = await platform.checkStatus(handle, account);

    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe(ErrorCode.CONTENT_REJECTED);
  });

  it('refuses a handle another platform produced', async () => {
    const platform = new YouTubePlatform({ logger: silentLogger });

    await expect(platform.checkStatus({ ...handle, platform: 'vimeo' }, account)).rejects.toThrow(
      /not a YouTube processing handle/,
    );
  });
});
