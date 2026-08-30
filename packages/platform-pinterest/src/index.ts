/**
 * `@bozonx/social-posting-pinterest` — Pinterest support for `@bozonx/social-posting`.
 */
import type { PlatformModule } from '@bozonx/social-posting';
import { PinterestPlatform } from './pinterest.platform.js';
import { PinterestAuthValidator } from './pinterest-auth.validator.js';
import { pinterestCapabilities } from './capabilities.js';

/** The descriptor a host registers to publish to Pinterest. */
export const pinterest: PlatformModule = {
  name: 'pinterest',
  // The API family this network speaks, when it shares one ('mastodon-api',
  // 'atproto'). Metadata only — see deriveModule() for serving a family.
  // dialect: undefined,
  capabilities: pinterestCapabilities,
  create: deps => new PinterestPlatform(deps),
  authValidator: new PinterestAuthValidator(),
};

export { PinterestPlatform } from './pinterest.platform.js';
export type { PinterestExtra, PinterestPlatformDeps } from './pinterest.platform.js';
export { PinterestAuthValidator } from './pinterest-auth.validator.js';
export { pinterestCapabilities } from './capabilities.js';
