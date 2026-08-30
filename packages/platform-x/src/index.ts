/**
 * `@bozonx/social-posting-x` — X support for `@bozonx/social-posting`.
 */
import type { PlatformModule } from '@bozonx/social-posting';
import { XPlatform } from './x.platform.js';
import { XAuthValidator } from './x-auth.validator.js';
import { xCapabilities } from './capabilities.js';

/** The descriptor a host registers to publish to X. */
export const x: PlatformModule = {
  name: 'x',
  // The API family this network speaks, when it shares one ('mastodon-api',
  // 'atproto'). Metadata only — see deriveModule() for serving a family.
  // dialect: undefined,
  capabilities: xCapabilities,
  create: deps => new XPlatform(deps),
  authValidator: new XAuthValidator(),
};

export { XPlatform } from './x.platform.js';
export type { XExtra, XPlatformDeps } from './x.platform.js';
export { XAuthValidator } from './x-auth.validator.js';
export { xCapabilities } from './capabilities.js';
