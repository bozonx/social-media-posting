import type { PlatformModule } from '@bozonx/social-posting';
import { BlueskyAuthValidator } from './bluesky-auth.validator.js';
import { BlueskyPlatform } from './bluesky.platform.js';
import { blueskyCapabilities } from './capabilities.js';

export const bluesky: PlatformModule = {
  name: 'bluesky',
  dialect: 'atproto',
  capabilities: blueskyCapabilities,
  create: deps => new BlueskyPlatform(deps),
  authValidator: new BlueskyAuthValidator(),
};
export { BlueskyPlatform } from './bluesky.platform.js';
export type { BlueskyAccountConfig, BlueskyPlatformDeps } from './bluesky.platform.js';
export { BlueskyAuthValidator } from './bluesky-auth.validator.js';
export { blueskyCapabilities } from './capabilities.js';
export { buildFacets, countGraphemes, utf8Length } from './rich-text.js';
