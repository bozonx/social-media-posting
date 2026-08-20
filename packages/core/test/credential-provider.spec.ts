import { describe, expect, it, vi } from 'vitest';
import { createPostingClient } from '../src/client.js';
import { PostType } from '../src/types/post-type.js';
import { ErrorCode } from '../src/errors/error-code.js';
import type { CredentialProvider } from '../src/auth/credentials.js';
import type { IPlatform } from '../src/platforms/platform.interface.js';
import type { PlatformModule } from '../src/platforms/platform-module.js';

function fakePlatform() {
  const platform: IPlatform & { publish: ReturnType<typeof vi.fn> } = {
    name: 'fake',
    capabilities: {
      name: 'fake',
      postTypes: {
        [PostType.POST]: { requiredFields: ['body'] },
      },
    },
    publish: vi.fn().mockResolvedValue({ status: 'published', postId: '1' }),
  };
  const platformModule: PlatformModule = {
    name: 'fake',
    capabilities: platform.capabilities,
    create: () => platform,
  };
  return { platform, platformModule };
}

const request = { platform: 'fake', account: 'main', body: 'hi', type: PostType.POST };

describe('CredentialProvider', () => {
  it('supplies the credentials a publish runs with', async () => {
    const { platform, platformModule } = fakePlatform();
    const provider: CredentialProvider = {
      getCredentials: vi.fn().mockResolvedValue({ accessToken: 'fresh-token' }),
    };

    const client = createPostingClient({
      accounts: { main: { platform: 'fake', auth: { accessToken: 'stale-token' } } },
      platforms: [platformModule],
      credentialProvider: provider,
    });

    await client.post(request);

    expect(provider.getCredentials).toHaveBeenCalledWith('main');
    expect(platform.publish).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ auth: expect.objectContaining({ accessToken: 'fresh-token' }) }),
      expect.anything(),
    );
  });

  it('is not consulted for inline credentials', async () => {
    const { platformModule } = fakePlatform();
    const provider: CredentialProvider = { getCredentials: vi.fn() };

    const client = createPostingClient({
      accounts: {},
      platforms: [platformModule],
      credentialProvider: provider,
    });

    await client.post({ ...request, account: undefined, auth: { accessToken: 'inline' } });

    expect(provider.getCredentials).not.toHaveBeenCalled();
  });

  it('surfaces a provider failure as an error result', async () => {
    const { platform, platformModule } = fakePlatform();
    const provider: CredentialProvider = {
      getCredentials: vi.fn().mockRejectedValue(new Error('vault unreachable')),
    };

    const client = createPostingClient({
      accounts: { main: { platform: 'fake', auth: {} } },
      platforms: [platformModule],
      credentialProvider: provider,
    });

    const result = await client.post(request);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain('vault unreachable');
    }
    expect(platform.publish).not.toHaveBeenCalled();
  });

  it('lets a validator demand re-authorization instead of a retry', async () => {
    const { platformModule } = fakePlatform();
    const client = createPostingClient({
      accounts: { main: { platform: 'fake', auth: { accessToken: 'spent' } } },
      platforms: [
        {
          ...platformModule,
          authValidator: {
            providerName: 'fake',
            validate: async () => ({
              errors: ['the access token expired and cannot be refreshed'],
              code: ErrorCode.AUTH_REFRESH_REQUIRED,
            }),
          },
        },
      ],
    });

    const result = await client.post(request);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCode.AUTH_REFRESH_REQUIRED);
      // Retrying can never fix this; only sending the user back through
      // authorization can.
      expect(result.error.retryable).toBe(false);
    }
  });

  it('reports a malformed credential as a validation error', async () => {
    const { platformModule } = fakePlatform();
    const client = createPostingClient({
      accounts: { main: { platform: 'fake', auth: {} } },
      platforms: [
        {
          ...platformModule,
          authValidator: {
            providerName: 'fake',
            validate: () => ({ errors: ["Field 'accessToken' is required"] }),
          },
        },
      ],
    });

    const result = await client.post(request);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCode.VALIDATION_ERROR);
    }
  });

  it('gives the validator the platform capabilities and the account name', async () => {
    const { platformModule } = fakePlatform();
    const validate = vi.fn().mockResolvedValue({ errors: [] });

    const client = createPostingClient({
      accounts: { main: { platform: 'fake', auth: { accessToken: 'x' } } },
      platforms: [{ ...platformModule, authValidator: { providerName: 'fake', validate } }],
    });

    await client.post(request);

    expect(validate).toHaveBeenCalledWith(
      { accessToken: 'x' },
      { capabilities: platformModule.capabilities, accountRef: 'main' },
    );
  });
});
