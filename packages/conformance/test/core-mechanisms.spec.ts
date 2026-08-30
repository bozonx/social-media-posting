import { describe, expect, it, vi } from 'vitest';
import {
  ErrorCode,
  PlatformError,
  PostType,
  createPostingClient,
  deriveModule,
} from '@bozonx/social-posting';
import type {
  PlatformCapabilities,
  PlatformModule,
  PostRequest,
  ResumeHandle,
  ResolvedAccountConfig,
} from '@bozonx/social-posting';
import {
  mergeCapabilities,
  validateAgainstCapabilities,
  validateCapabilities,
} from '@bozonx/social-posting/platform';
import type {
  IPlatform,
  PlatformPublishResponse,
  PublishOptions,
  RuntimeCapabilities,
} from '@bozonx/social-posting/platform';

/**
 * Conformance for the core's own mechanisms.
 *
 * The rule the plan sets: a mechanism without a case here is not done. These
 * are written against fictional networks precisely so they test the core and
 * not one adapter's habits.
 */

const pullCapabilities: PlatformCapabilities = {
  name: 'pull-network',
  postTypes: {
    [PostType.IMAGE]: { requiredFields: ['media'] },
    [PostType.SHORT_VIDEO]: { requiredFields: ['media'] },
  },
  media: {
    image: { acceptedSources: ['url'], transport: 'pull', requiresPubliclyFetchableUrl: true },
    video: {
      acceptedSources: ['url'],
      transport: 'pull',
      requiresPubliclyFetchableUrl: true,
      urlMustRemainAvailableForSecs: 3600,
    },
  },
};

const pushCapabilities: PlatformCapabilities = {
  name: 'push-network',
  postTypes: { [PostType.IMAGE]: { requiredFields: ['media'] } },
  media: { image: { acceptedSources: ['bytes', 'blob', 'stream'], transport: 'push' } },
};

describe('canonical post type names', () => {
  it('refuses a non-canonical type name when the module is registered', () => {
    expect(() =>
      validateCapabilities({
        name: 'snake-network',
        postTypes: { short_video: { requiredFields: ['media'] } },
      }),
    ).toThrow(/short_video/);
  });

  it('accepts a namespaced platform extension', () => {
    expect(() =>
      validateCapabilities({
        name: 'telegramish',
        postTypes: { 'x-telegramish-videoNote': { requiredFields: ['media'] } },
      }),
    ).not.toThrow();
  });

  it("never infers 'shortVideo' from media alone", () => {
    const validation = validateAgainstCapabilities(
      {
        platform: 'pull-network',
        media: [{ type: 'video', source: { kind: 'url', url: 'https://cdn.test/a.mp4' } }],
      },
      pullCapabilities,
    );
    expect(validation.detectedType).toBe(PostType.VIDEO);
  });
});

describe('media transport', () => {
  it('refuses bytes on a pull-only network', () => {
    const validation = validateAgainstCapabilities(
      {
        platform: 'pull-network',
        type: PostType.IMAGE,
        media: [{ type: 'image', source: { kind: 'bytes', bytes: new Uint8Array([1, 2]) } }],
      },
      pullCapabilities,
    );
    expect(validation.issues.map(i => i.code)).toContain('MEDIA_TRANSPORT_PULL_ONLY');
  });

  it('refuses a bare URL on a push-only network', () => {
    const validation = validateAgainstCapabilities(
      {
        platform: 'push-network',
        type: PostType.IMAGE,
        media: [{ type: 'image', source: { kind: 'url', url: 'https://cdn.test/a.jpg' } }],
      },
      pushCapabilities,
    );
    expect(validation.issues.map(i => i.code)).toContain('MEDIA_TRANSPORT_PUSH_ONLY');
  });

  it('refuses a URL the network could not fetch', () => {
    const validation = validateAgainstCapabilities(
      {
        platform: 'pull-network',
        type: PostType.IMAGE,
        media: [{ type: 'image', source: { kind: 'url', url: 'file:///tmp/a.jpg' } }],
      },
      pullCapabilities,
    );
    expect(validation.issues.map(i => i.code)).toContain('MEDIA_URL_NOT_PUBLIC');
  });
});

describe('structural target', () => {
  const boardCapabilities: PlatformCapabilities = {
    name: 'board-network',
    postTypes: { [PostType.IMAGE]: { requiredFields: ['media'] } },
    media: { image: { acceptedSources: ['url'], transport: 'pull' } },
    auth: { kind: 'oauth2', requiresTarget: true },
    targetSchema: [
      { name: 'sectionId', type: 'string', maxLength: 40 },
      { name: 'boardKind', type: 'enum', values: ['public', 'secret'] },
    ],
  };

  const request = (target: PostRequest['target']): PostRequest => ({
    platform: 'board-network',
    type: PostType.IMAGE,
    target,
    media: [{ type: 'image', source: { kind: 'url', url: 'https://cdn.test/a.jpg' } }],
  });

  it('accepts a two-part address', () => {
    const validation = validateAgainstCapabilities(
      request({ id: 'board-1', sectionId: 'section-9', boardKind: 'public' }),
      boardCapabilities,
    );
    expect(validation.issues).toEqual([]);
  });

  it('refuses a part the descriptor does not declare', () => {
    const validation = validateAgainstCapabilities(
      request({ id: 'board-1', shelfId: 'nope' }),
      boardCapabilities,
    );
    expect(validation.issues.map(i => i.code)).toContain('UNKNOWN_EXTRA_FIELD');
  });

  it('refuses a declared part of the wrong type', () => {
    const validation = validateAgainstCapabilities(
      request({ id: 'board-1', boardKind: 'private' }),
      boardCapabilities,
    );
    expect(validation.issues.map(i => i.code)).toContain('INVALID_ENUM_VALUE');
  });

  it('reports a missing target where one is required', () => {
    const validation = validateAgainstCapabilities(request(undefined), boardCapabilities);
    expect(validation.issues.map(i => i.code)).toContain('TARGET_REQUIRED');
  });
});

describe('resolveCapabilities', () => {
  class DynamicPlatform implements IPlatform {
    readonly name = 'dynamic-network';
    readonly capabilities: PlatformCapabilities = {
      name: 'dynamic-network',
      postTypes: { [PostType.POST]: { requiredFields: ['body'] } },
      maxBodyLength: 500,
      supportedBodyFormats: ['text', 'html'],
    };

    calls = 0;

    publish(): Promise<PlatformPublishResponse> {
      return Promise.resolve({ status: 'published', postId: 'p1' });
    }

    resolveCapabilities(): Promise<RuntimeCapabilities> {
      this.calls += 1;
      return Promise.resolve({
        capabilities: { maxBodyLength: 1000, supportedBodyFormats: ['text'] },
        cacheableForSecs: 0,
        fetchedAt: new Date().toISOString(),
      });
    }
  }

  const platform = new DynamicPlatform();
  const client = createPostingClient({
    accounts: { acc: { platform: 'dynamic-network', auth: { apiKey: 'k' } } },
    platforms: [
      {
        name: 'dynamic-network',
        capabilities: platform.capabilities,
        create: () => platform,
      },
    ],
  });

  it('merges runtime over static: scalars override, lists are replaced whole', () => {
    const merged = mergeCapabilities(platform.capabilities, {
      maxBodyLength: 1000,
      supportedBodyFormats: ['text'],
    });
    expect(merged.maxBodyLength).toBe(1000);
    expect(merged.supportedBodyFormats).toEqual(['text']);
    // Untouched fields keep their static value.
    expect(merged.postTypes).toEqual(platform.capabilities.postTypes);
  });

  it('asks the platform again every time: the library remembers nothing', async () => {
    const before = platform.calls;
    await client.resolveCapabilities({ platform: 'dynamic-network', account: 'acc' });
    await client.resolveCapabilities({ platform: 'dynamic-network', account: 'acc' });
    expect(platform.calls - before).toBe(2);
  });

  it('previews against the resolved limits when the host passes them', async () => {
    const resolved = await client.resolveCapabilities({
      platform: 'dynamic-network',
      account: 'acc',
    });
    const body = 'a'.repeat(700);

    const staticPreview = await client.preview({
      platform: 'dynamic-network',
      account: 'acc',
      body,
    });
    const dynamicPreview = await client.preview(
      { platform: 'dynamic-network', account: 'acc', body },
      { capabilities: resolved.capabilities },
    );

    expect(staticPreview.success && staticPreview.data.valid).toBe(false);
    expect(dynamicPreview.success && dynamicPreview.data.valid).toBe(true);
  });
});

describe('unknown outcome', () => {
  class AmbiguousPlatform implements IPlatform {
    readonly name = 'ambiguous-network';
    readonly capabilities: PlatformCapabilities = {
      name: 'ambiguous-network',
      postTypes: { [PostType.POST]: { requiredFields: ['body'] } },
    };

    createCalls = 0;
    reconcileAnswer: 'published' | 'absent' | 'unknown' | 'none' = 'none';

    publish(
      _request: PostRequest,
      _account: ResolvedAccountConfig,
      _options?: PublishOptions,
    ): Promise<PlatformPublishResponse> {
      this.createCalls += 1;
      return Promise.reject(
        new PlatformError('create timed out', ErrorCode.TIMEOUT_ERROR, {
          retryable: true,
          outcomeUnknown: true,
          resumeHandle: {
            platform: 'ambiguous-network',
            step: 'create',
            state: { attemptId: 'a-1' },
          },
        }),
      );
    }

    reconcile(
      _handle?: ResumeHandle,
      _account?: ResolvedAccountConfig,
      _signal?: AbortSignal,
    ): Promise<
      { status: 'published'; postId: string } | { status: 'absent' } | { status: 'unknown' }
    > {
      if (this.reconcileAnswer === 'published') {
        return Promise.resolve({ status: 'published', postId: 'found-1' });
      }
      if (this.reconcileAnswer === 'absent') {
        return Promise.resolve({ status: 'absent' });
      }
      return Promise.resolve({ status: 'unknown' });
    }
  }

  function clientFor(platform: IPlatform) {
    return createPostingClient({
      accounts: { acc: { platform: platform.name, auth: { apiKey: 'k' } } },
      platforms: [
        { name: platform.name, capabilities: platform.capabilities, create: () => platform },
      ],
    });
  }

  const request: PostRequest = {
    platform: 'ambiguous-network',
    account: 'acc',
    body: 'hello',
  };

  it('reports UNKNOWN_OUTCOME rather than publishing twice', async () => {
    const platform = new AmbiguousPlatform();
    platform.reconcileAnswer = 'unknown';

    const result = await clientFor(platform).post(request);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCode.UNKNOWN_OUTCOME);
      expect(result.error.retryable).toBe(false);
    }
    expect(platform.createCalls).toBe(1);
  });

  it('returns the post reconcile found instead of an error', async () => {
    const platform = new AmbiguousPlatform();
    platform.reconcileAnswer = 'published';

    const result = await clientFor(platform).post(request);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.postId).toBe('found-1');
    }
  });

  it('marks an absent reconciled create retryable and passes an abort signal to reconciliation', async () => {
    const platform = new AmbiguousPlatform();
    platform.reconcileAnswer = 'absent';
    const reconcile = vi.spyOn(platform, 'reconcile');

    const result = await clientFor(platform).post(request);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.retryable).toBe(true);
    }
    expect(reconcile).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything());
  });

  it('keeps the original retryable error when nothing was created', async () => {
    const platform = new AmbiguousPlatform();
    platform.reconcileAnswer = 'absent';

    const result = await clientFor(platform).post(request);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCode.TIMEOUT_ERROR);
      expect(result.error.retryable).toBe(true);
    }
  });
});

describe('deriveModule', () => {
  const base: PlatformModule = {
    name: 'mastodon',
    dialect: 'mastodon-api',
    capabilities: {
      name: 'mastodon',
      postTypes: { [PostType.POST]: { requiredFields: ['body'] } },
      maxBodyLength: 500,
      requiresApiBaseUrl: true,
    },
    create: () => ({
      name: 'mastodon',
      capabilities: { name: 'mastodon', postTypes: { [PostType.POST]: {} } },
      publish: () => Promise.resolve({ status: 'published' as const, postId: 'x' }),
    }),
  };

  const pixelfed = deriveModule(base, {
    name: 'pixelfed',
    capabilities: {
      name: 'pixelfed',
      postTypes: { [PostType.IMAGE]: { requiredFields: ['media'] } },
      media: { image: { acceptedSources: ['bytes'], transport: 'push' } },
      requiresApiBaseUrl: true,
    },
  });

  it('answers as the derived network while reusing the base implementation', () => {
    const instance = pixelfed.create({
      logger: { debug: vi.fn(), log: vi.fn(), error: vi.fn(), warn: vi.fn() },
    });
    expect(pixelfed.name).toBe('pixelfed');
    expect(pixelfed.dialect).toBe('mastodon-api');
    expect(instance.name).toBe('pixelfed');
    expect(instance.capabilities.postTypes.image).toBeDefined();
    expect(instance.publish).toBeTypeOf('function');
  });

  it('refuses a descriptor that names a different network', () => {
    expect(() =>
      deriveModule(base, {
        name: 'pixelfed',
        capabilities: { name: 'mastodon', postTypes: { [PostType.POST]: {} } },
      }),
    ).toThrow(/same name/);
  });
});

describe('per-instance accounts', () => {
  const instanceModule: PlatformModule = {
    name: 'instance-network',
    capabilities: {
      name: 'instance-network',
      postTypes: { [PostType.POST]: { requiredFields: ['body'] } },
      requiresApiBaseUrl: true,
    },
    create: () => ({
      name: 'instance-network',
      capabilities: {
        name: 'instance-network',
        postTypes: { [PostType.POST]: { requiredFields: ['body'] } },
        requiresApiBaseUrl: true,
      },
      publish: () => Promise.resolve({ status: 'published' as const, postId: 'p1' }),
    }),
  };

  it('refuses an account with no apiBaseUrl when the network is per-instance', async () => {
    const client = createPostingClient({
      accounts: { acc: { platform: 'instance-network', auth: { accessToken: 't' } } },
      platforms: [instanceModule],
    });

    const result = await client.post({
      platform: 'instance-network',
      account: 'acc',
      body: 'hi',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toMatch(/apiBaseUrl/);
    }
  });

  it('publishes once the account names its instance', async () => {
    const client = createPostingClient({
      accounts: {
        acc: {
          platform: 'instance-network',
          auth: { accessToken: 't' },
          apiBaseUrl: 'https://social.example',
        },
      },
      platforms: [instanceModule],
    });

    const result = await client.post({
      platform: 'instance-network',
      account: 'acc',
      body: 'hi',
    });

    expect(result.success).toBe(true);
  });
});

describe('resume handles', () => {
  class LeakyPlatform implements IPlatform {
    readonly name = 'leaky-network';
    readonly capabilities: PlatformCapabilities = {
      name: 'leaky-network',
      postTypes: { [PostType.POST]: { requiredFields: ['body'] } },
    };

    async publish(): Promise<PlatformPublishResponse> {
      throw new PlatformError('upload failed', ErrorCode.NETWORK_ERROR, {
        retryable: true,
        resumeHandle: {
          platform: 'leaky-network',
          step: 'upload',
          state: {
            offsetBytes: 1024,
            uploadUrl: 'https://upload.example/session/9?token=abc',
            accessToken: 'secret-token',
          },
        },
      });
    }
  }

  const request: PostRequest = { platform: 'leaky-network', account: 'acc', body: 'hi' };

  function clientWith(strict: boolean) {
    const platform = new LeakyPlatform();
    return createPostingClient({
      accounts: { acc: { platform: 'leaky-network', auth: { apiKey: 'k' } } },
      platforms: [
        { name: 'leaky-network', capabilities: platform.capabilities, create: () => platform },
      ],
      strictResumeHandles: strict,
    });
  }

  it('strips secrets from a handle before the host can store it', async () => {
    const result = await clientWith(false).post(request);

    expect(result.success).toBe(false);
    if (!result.success) {
      const state = result.error.resumeHandle?.state ?? {};
      expect(state.offsetBytes).toBe(1024);
      expect(state.uploadUrl).toBeUndefined();
      expect(state.accessToken).toBeUndefined();
    }
  });

  it('fails loudly in strict mode, which is how development runs', async () => {
    const result = await clientWith(true).post(request);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toMatch(/carries secrets/);
    }
  });
});
