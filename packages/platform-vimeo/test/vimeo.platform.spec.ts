import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorCode, PostType, findResumeHandleSecrets } from '@bozonx/social-posting';
import type {
  ILogger,
  PostRequest,
  ResolvedAccountConfig,
  ResumeHandle,
} from '@bozonx/social-posting';
import { VimeoPlatform, PROCESSING_STEP } from '../src/vimeo.platform.js';
import success from './fixtures/success.json' with { type: 'json' };

const silentLogger: ILogger = { debug: () => {}, log: () => {}, warn: () => {}, error: () => {} };

const CHUNK = 64 * 1024;
const TUS_LINK = 'https://files.tus.vimeo.com/files/session-42';

const account: ResolvedAccountConfig = {
  platform: 'vimeo',
  source: 'account',
  accountRef: 'channel-1',
  auth: { accessToken: 'vimeo-token' },
  chunkSizeBytes: CHUNK,
};

const videoBytes = new Uint8Array(CHUNK).fill(2);

function request(overrides: Partial<PostRequest> = {}): PostRequest {
  return {
    platform: 'vimeo',
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

const created = {
  ...success.createdVideo.body,
  upload: { ...success.createdVideo.body.upload, upload_link: TUS_LINK },
};

function respondToUpload(url: string): Response {
  if (url.startsWith(TUS_LINK)) {
    return new Response(null, { status: 204, headers: { 'upload-offset': String(CHUNK) } });
  }
  return new Response(JSON.stringify(created), {
    status: 201,
    headers: { 'content-type': 'application/json' },
  });
}

describe('VimeoPlatform.publish', () => {
  it('uploads through tus by default and reports processing', async () => {
    const calls = stubFetch(respondToUpload);
    const platform = new VimeoPlatform({ logger: silentLogger });

    const result = await platform.publish(request(), account);

    expect(result.status).toBe('processing');
    expect(result.postId).toBe('987654321');
    expect(result.handle?.state.videoUri).toBe('/videos/987654321');
    const body = JSON.parse(String(calls[0]?.init.body)) as { upload: { approach: string } };
    expect(body.upload.approach).toBe('tus');
  });

  it('keeps the tus upload link — a bearer URL — out of the resume handle', async () => {
    stubFetch(url => {
      if (url.startsWith(TUS_LINK)) {
        return new Response(JSON.stringify({ error: 'Vimeo is temporarily unavailable.' }), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify(created), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      });
    });
    const platform = new VimeoPlatform({ logger: silentLogger });

    const error = await platform.publish(request(), account).catch((thrown: unknown) => thrown);
    const handle = (error as { resumeHandle?: ResumeHandle }).resumeHandle;

    expect(handle).toBeDefined();
    expect(findResumeHandleSecrets(handle as ResumeHandle)).toEqual([]);
    expect(JSON.stringify(handle)).not.toContain('files.tus.vimeo.com');
    // Only the video is named; the link is re-read from it on resume.
    expect(handle?.state.videoUri).toBe('/videos/987654321');
  });

  it('hands Vimeo the URL when the pull approach is asked for', async () => {
    const calls = stubFetch(
      () =>
        new Response(JSON.stringify(success.createdByPull.body), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        }),
    );
    const platform = new VimeoPlatform({ logger: silentLogger });

    const result = await platform.publish(
      request({
        media: [{ type: 'video', source: { kind: 'url', url: 'https://cdn.example.com/v.mp4' } }],
        extra: { uploadApproach: 'pull' },
      }),
      account,
    );

    expect(result.status).toBe('processing');
    // One call: no bytes pass through this process at all.
    expect(calls).toHaveLength(1);
    const body = JSON.parse(String(calls[0]?.init.body)) as {
      upload: { approach: string; link: string };
    };
    expect(body.upload).toEqual({ approach: 'pull', link: 'https://cdn.example.com/v.mp4' });
  });

  it('refuses the pull approach when there is no link for Vimeo to fetch', async () => {
    const calls = stubFetch(respondToUpload);
    const platform = new VimeoPlatform({ logger: silentLogger });

    await expect(
      platform.publish(request({ extra: { uploadApproach: 'pull' } }), account),
    ).rejects.toThrow(/url. source/);
    expect(calls).toHaveLength(0);
  });

  it('refuses a request that sets visibility and privacyView at once', async () => {
    const calls = stubFetch(respondToUpload);
    const platform = new VimeoPlatform({ logger: silentLogger });

    await expect(
      platform.publish(
        request({ visibility: 'public', extra: { privacyView: 'nobody' } }),
        account,
      ),
    ).rejects.toThrow(/same Vimeo field/);
    expect(calls).toHaveLength(0);
  });

  it('refuses a video whose size is unknown, because tus reserves space up front', async () => {
    const calls = stubFetch(respondToUpload);
    const platform = new VimeoPlatform({ logger: silentLogger });

    await expect(
      platform.publish(
        request({
          media: [
            {
              type: 'video',
              mimeType: 'video/mp4',
              source: {
                kind: 'stream',
                open: () => Promise.resolve(new ReadableStream<Uint8Array>()),
              },
            },
          ],
        }),
        account,
      ),
    ).rejects.toThrow(/size of the video/);
    expect(calls).toHaveLength(0);
  });
});

describe('VimeoPlatform.checkStatus', () => {
  const handle: ResumeHandle = {
    version: 1,
    platform: 'vimeo',
    step: PROCESSING_STEP,
    state: { videoUri: '/videos/987654321', approach: 'tus' },
  };

  it('stays processing while the transcode is in progress', async () => {
    stubFetch(
      () =>
        new Response(JSON.stringify(success.transcoding.body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    const platform = new VimeoPlatform({ logger: silentLogger });

    const result = await platform.checkStatus(handle, account);

    expect(result.status).toBe('processing');
  });

  it('publishes on transcode.status, not on the video reading available', async () => {
    stubFetch(
      () =>
        new Response(JSON.stringify(success.available.body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    const platform = new VimeoPlatform({ logger: silentLogger });

    const result = await platform.checkStatus(handle, account);

    expect(result.status).toBe('published');
    expect(result.url).toBe('https://vimeo.com/987654321');
  });

  it('reports a failed transcode as content Vimeo refused', async () => {
    stubFetch(
      () =>
        new Response(JSON.stringify(success.transcodeError.body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    const platform = new VimeoPlatform({ logger: silentLogger });

    const result = await platform.checkStatus(handle, account);

    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe(ErrorCode.CONTENT_REJECTED);
  });
});

describe('VimeoPlatform.getQuota', () => {
  it('reports bytes, and the tighter of storage and the weekly allowance', async () => {
    stubFetch(
      () =>
        new Response(JSON.stringify(success.quota.body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    const platform = new VimeoPlatform({ logger: silentLogger });

    const quota = await platform.getQuota(account);

    // The weekly allowance is smaller than the free space, so it is what will
    // actually stop the next upload — and what the user must be told about.
    expect(quota.unit).toBe('bytes');
    expect(quota.remaining).toBe(4_294_967_296);
    expect(quota.resetsAt).toBe('2026-09-06T00:00:00+00:00');
  });
});
