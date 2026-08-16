import { describe, expect, it, vi } from 'vitest';
import { createPostingClient } from '../src/client.js';
import { PostType } from '../src/types/post-type.js';
import { ErrorCode } from '../src/errors/error-code.js';
import type { ILogger } from '../src/logger/logger.js';
import type { IAuthValidator } from '../src/platforms/auth-validator.interface.js';
import type { IPlatform } from '../src/platforms/platform.interface.js';
import type { PlatformModule } from '../src/platforms/platform-module.js';

type FakePlatform = IPlatform & {
  publish: ReturnType<typeof vi.fn>;
  preview: ReturnType<typeof vi.fn>;
};

function fakePlatform(name = 'fake'): FakePlatform {
  return {
    name,
    capabilities: { name, supportedTypes: [PostType.AUTO, PostType.POST] },
    publish: vi
      .fn()
      .mockResolvedValue({ status: 'published', postId: '1', url: `https://${name}/1` }),
    preview: vi.fn().mockResolvedValue({
      success: true,
      data: {
        valid: true,
        detectedType: PostType.POST,
        convertedBody: 'hi',
        targetFormat: 'text',
        convertedBodyLength: 2,
        warnings: [],
      },
    }),
  };
}

/** Wrap a platform instance in the descriptor a host would register. */
function moduleOf(platform: FakePlatform, authValidator?: IAuthValidator): PlatformModule {
  return {
    name: platform.name,
    capabilities: platform.capabilities,
    create: () => platform,
    authValidator,
  };
}

const accounts = {
  main: { platform: 'fake', auth: { token: 'secret' }, channelId: '123' },
};

const request = {
  platform: 'fake',
  account: 'main',
  body: 'hi',
  type: PostType.POST,
};

describe('createPostingClient', () => {
  it('serves only the platforms it was given', () => {
    const client = createPostingClient({ accounts, platforms: [moduleOf(fakePlatform())] });

    expect(client.getRegisteredPlatforms()).toEqual(['fake']);
  });

  it('ships no platform of its own', async () => {
    const client = createPostingClient({ accounts });

    expect(client.getRegisteredPlatforms()).toEqual([]);
    const result = await client.post(request);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCode.VALIDATION_ERROR);
    }
  });

  it('accepts a platform registered after construction', async () => {
    const client = createPostingClient({ accounts });
    const platform = fakePlatform();

    client.registerPlatform(moduleOf(platform));
    const result = await client.post(request);

    expect(result.success).toBe(true);
    expect(platform.publish).toHaveBeenCalledTimes(1);
  });

  it('writes to the logger it was given and to nothing else', async () => {
    const lines: string[] = [];
    const logger: ILogger = {
      debug: message => lines.push(`debug:${message}`),
      log: message => lines.push(`log:${message}`),
      warn: message => lines.push(`warn:${message}`),
      error: message => lines.push(`error:${message}`),
    };
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const client = createPostingClient({
      accounts,
      logger,
      platforms: [moduleOf(fakePlatform())],
    });
    await client.post(request);

    expect(lines.some(line => line.startsWith('log:Publishing to fake'))).toBe(true);
    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('runs credential validators registered for a platform', async () => {
    const validator: IAuthValidator = {
      providerName: 'fake',
      validate: auth => ({ errors: auth.token ? [] : ['token is required'] }),
    };
    const client = createPostingClient({
      accounts: { main: { platform: 'fake', auth: {} } },
      platforms: [moduleOf(fakePlatform(), validator)],
    });

    const result = await client.post(request);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain('token is required');
    }
  });

  it('rejects an invalid configuration at construction time', () => {
    expect(() => createPostingClient({ accounts: { bad: {} as never } })).toThrow(
      /Posting config validation error/,
    );
    expect(() => createPostingClient({ accounts: {}, requestTimeoutSecs: 10_000 })).toThrow(
      /requestTimeoutSecs/,
    );
  });

  it('keeps two clients in one process independent', async () => {
    const platformA = fakePlatform();
    const platformB = fakePlatform();
    const clientA = createPostingClient({ accounts, platforms: [moduleOf(platformA)] });
    const clientB = createPostingClient({
      accounts: { main: { platform: 'fake', auth: { token: 'other' } } },
      platforms: [moduleOf(platformB)],
    });

    await clientA.post(request);

    expect(platformA.publish).toHaveBeenCalledTimes(1);
    expect(platformB.publish).not.toHaveBeenCalled();
  });

  it('previews without touching the publish path', async () => {
    const platform = fakePlatform();
    const client = createPostingClient({ accounts, platforms: [moduleOf(platform)] });

    const result = await client.preview(request);

    expect(result.success).toBe(true);
    expect(platform.publish).not.toHaveBeenCalled();
  });
});
