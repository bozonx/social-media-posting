import { vi, type Mock } from 'vitest';
import { PostType } from '@bozonx/social-posting';
import type { PlatformCapabilities, PlatformModule } from '@bozonx/social-posting';
import type { IPlatform } from '@bozonx/social-posting/platform';

export type FakePlatform = IPlatform & {
  publish: Mock<IPlatform['publish']>;
  checkStatus: Mock<NonNullable<IPlatform['checkStatus']>>;
  capabilities: PlatformCapabilities;
};

/** A platform double with the capabilities the shell's tests need. */
export function fakePlatform(
  name = 'telegram',
  capabilities: Partial<PlatformCapabilities> = {},
): { platform: FakePlatform; platformModule: PlatformModule } {
  const resolved: PlatformCapabilities = {
    name,
    postTypes: {
      [PostType.POST]: {},
      [PostType.IMAGE]: {},
      [PostType.VIDEO]: {},
      [PostType.ALBUM]: {},
      [PostType.DOCUMENT]: {},
    },
    ...capabilities,
  };

  const platform: FakePlatform = {
    name,
    capabilities: resolved,
    publish: vi.fn<IPlatform['publish']>().mockResolvedValue({ status: 'published', postId: '1' }),
    checkStatus: vi.fn<NonNullable<IPlatform['checkStatus']>>(),
  };

  return {
    platform,
    platformModule: { name, capabilities: resolved, create: () => platform },
  };
}
