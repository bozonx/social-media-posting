import { describe, expect, it, vi } from 'vitest';
import { createPostingClient } from '../src/client.js';
import { PostType } from '../src/types/post-type.js';
import { ErrorCode } from '../src/errors/error-code.js';
import type { ILogger } from '../src/logger/logger.js';
import type { IAuthValidator } from '../src/platforms/auth-validator.interface.js';
import type { IPlatform } from '../src/platforms/platform.interface.js';
import type { PlatformModule } from '../src/platforms/platform-module.js';
import type { CredentialProvider } from '../src/auth/credentials.js';

type FakePlatform = IPlatform & {
  publish: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

function fakePlatform(name = 'fake'): FakePlatform {
  return {
    name,
    capabilities: {
      name,
      postTypes: {
        [PostType.POST]: { requiredFields: ['body'] },
      },
    },
    publish: vi.fn().mockResolvedValue({
      status: 'published',
      postId: '1',
      url: `https://${name}/1`,
      parts: [{ id: '1' }],
      ref: { postId: '1', parts: [{ id: '1' }] },
    }),
    delete: vi.fn().mockResolvedValue({
      status: 'deleted',
      parts: [{ id: '1', status: 'deleted' }],
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
  main: { platform: 'fake', auth: { token: 'secret' }, target: '123' },
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

  it('passes the host credential provider through the platform factory seam', () => {
    const provider: CredentialProvider = { getCredentials: vi.fn() };
    const create = vi.fn(() => fakePlatform());
    const platform = fakePlatform();

    createPostingClient({
      accounts,
      credentialProvider: provider,
      platforms: [{ name: 'fake', capabilities: platform.capabilities, create }],
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ credentialProvider: provider, logger: expect.anything() }),
    );
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
    const _clientB = createPostingClient({
      accounts: { main: { platform: 'fake', auth: { token: 'other' } } },
      platforms: [moduleOf(platformB)],
    });

    await clientA.post(request);

    expect(platformA.publish).toHaveBeenCalledTimes(1);
    expect(platformB.publish).not.toHaveBeenCalled();
  });

  it('keeps an immutable snapshot of account configuration', async () => {
    const mutableAccounts = {
      main: { platform: 'fake', auth: { token: 'original', scopes: ['post'] } },
    };
    const platform = fakePlatform();
    const client = createPostingClient({
      accounts: mutableAccounts,
      platforms: [moduleOf(platform)],
    });

    mutableAccounts.main.auth.token = 'changed';
    mutableAccounts.main.auth.scopes.push('admin');
    await client.post(request);

    expect(platform.publish).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ auth: { token: 'original', scopes: ['post'] } }),
      expect.anything(),
    );
  });

  it('previews without touching the publish path', async () => {
    const platform = fakePlatform();
    const client = createPostingClient({ accounts, platforms: [moduleOf(platform)] });

    const result = await client.preview(request);

    expect(result.success).toBe(true);
    expect(platform.publish).not.toHaveBeenCalled();
  });

  it('deletes posts through client.delete', async () => {
    const platform = fakePlatform();
    const client = createPostingClient({ accounts, platforms: [moduleOf(platform)] });

    const result = await client.delete({ platform: 'fake', account: 'main' }, { postId: '1' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('deleted');
    }
    expect(platform.delete).toHaveBeenCalledTimes(1);
  });
});
