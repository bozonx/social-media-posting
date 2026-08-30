/**
 * `@bozonx/social-posting-tiktok` — Tiktok support for `@bozonx/social-posting`.
 */
import type { PlatformModule } from '@bozonx/social-posting';
import { TiktokPlatform } from './tiktok.platform.js';
import { TiktokAuthValidator } from './tiktok-auth.validator.js';
import { tiktokCapabilities } from './capabilities.js';

/** The descriptor a host registers to publish to Tiktok. */
export const tiktok: PlatformModule = {
  name: 'tiktok',
  // The API family this network speaks, when it shares one ('mastodon-api',
  // 'atproto'). Metadata only — see deriveModule() for serving a family.
  // dialect: undefined,
  capabilities: tiktokCapabilities,
  create: deps => new TiktokPlatform(deps),
  authValidator: new TiktokAuthValidator(),
};

export { TiktokPlatform } from './tiktok.platform.js';
export type { TikTokExtra, TiktokPlatformDeps } from './tiktok.platform.js';
export { TiktokAuthValidator } from './tiktok-auth.validator.js';
export { tiktokCapabilities } from './capabilities.js';
