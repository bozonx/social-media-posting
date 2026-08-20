import { describe, expect, it } from 'vitest';
import { PlatformRegistry } from '../src/platforms/platform-registry.js';
import { ValidationError } from '../src/errors/posting-error.js';
import { PostType } from '../src/types/post-type.js';
import type { IPlatform } from '../src/platforms/platform.interface.js';
import type { PlatformCapabilities } from '../src/platforms/capabilities.js';

function createMockPlatform(
  name: string,
  capabilitiesOverrides: Partial<PlatformCapabilities> = {},
): IPlatform {
  return {
    name,
    capabilities: {
      name,
      postTypes: {
        [PostType.POST]: { requiredFields: ['body'] },
        [PostType.IMAGE]: { requiredFields: ['media'] },
      },
      ...capabilitiesOverrides,
    },
    publish: async () => ({ status: 'published', postId: '123' }),
  };
}

describe('PlatformRegistry', () => {
  it('registers and retrieves platforms case-insensitively', () => {
    const registry = new PlatformRegistry();
    const telegramPlatform = createMockPlatform('Telegram');

    registry.register(telegramPlatform);

    expect(registry.has('telegram')).toBe(true);
    expect(registry.has('Telegram')).toBe(true);
    expect(registry.has('TELEGRAM')).toBe(true);
    expect(registry.get('telegram')).toBe(telegramPlatform);
    expect(registry.get('TELEGRAM')).toBe(telegramPlatform);
  });

  it('throws ValidationError when getting an unregistered platform', () => {
    const registry = new PlatformRegistry();

    expect(() => registry.get('unsupported')).toThrow(ValidationError);
    expect(() => registry.get('unsupported')).toThrow('Platform "unsupported" is not supported');
  });

  it('lists all registered platforms in lower-case', () => {
    const registry = new PlatformRegistry();
    registry.register(createMockPlatform('Telegram'));
    registry.register(createMockPlatform('VK'));
    registry.register(createMockPlatform('Twitter'));

    const platforms = registry.getRegisteredPlatforms();

    expect(platforms).toEqual(['telegram', 'vk', 'twitter']);
  });

  it('replaces an existing platform with the same name upon re-registration', () => {
    const registry = new PlatformRegistry();
    const platformV1 = createMockPlatform('telegram');
    const platformV2 = createMockPlatform('telegram');

    registry.register(platformV1);
    expect(registry.get('telegram')).toBe(platformV1);

    registry.register(platformV2);
    expect(registry.get('telegram')).toBe(platformV2);
    expect(registry.getRegisteredPlatforms()).toEqual(['telegram']);
  });

  it('returns platform capabilities via getCapabilities', () => {
    const registry = new PlatformRegistry();
    const capabilities: PlatformCapabilities = {
      name: 'custom',
      postTypes: {
        [PostType.VIDEO]: { requiredFields: ['media'] },
      },
      maxBodyLength: 500,
    };
    registry.register(createMockPlatform('custom', capabilities));

    expect(registry.getCapabilities('custom')).toEqual(capabilities);
    expect(registry.getCapabilities('CUSTOM')).toEqual(capabilities);
  });

  it('throws ValidationError in getCapabilities when platform is unknown', () => {
    const registry = new PlatformRegistry();

    expect(() => registry.getCapabilities('unknown')).toThrow(ValidationError);
  });
});
