import { vi, type Mock } from 'vitest';
import { PostType } from '@bozonx/social-posting';
import type { IPlatform, PlatformCapabilities, PlatformModule } from '@bozonx/social-posting';

export type FakePlatform = IPlatform & {
  publish: Mock<IPlatform['publish']>;
  preview: Mock<NonNullable<IPlatform['preview']>>;
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
    supportedTypes: [
      PostType.AUTO,
      PostType.POST,
      PostType.IMAGE,
      PostType.VIDEO,
      PostType.ALBUM,
      PostType.DOCUMENT,
    ],
    ...capabilities,
  };

  const platform: FakePlatform = {
    name,
    capabilities: resolved,
    publish: vi.fn<IPlatform['publish']>().mockResolvedValue({ status: 'published', postId: '1' }),
    preview: vi.fn<NonNullable<IPlatform['preview']>>(),
    checkStatus: vi.fn<NonNullable<IPlatform['checkStatus']>>(),
  };

  return {
    platform,
    platformModule: { name, capabilities: resolved, create: () => platform },
  };
}
