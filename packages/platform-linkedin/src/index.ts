/**
 * `@bozonx/social-posting-linkedin` — Linkedin support for `@bozonx/social-posting`.
 */
import type { PlatformModule } from '@bozonx/social-posting';
import { LinkedinPlatform } from './linkedin.platform.js';
import { LinkedinAuthValidator } from './linkedin-auth.validator.js';
import { linkedinCapabilities } from './capabilities.js';

/** The descriptor a host registers to publish to Linkedin. */
export const linkedin: PlatformModule = {
  name: 'linkedin',
  // The API family this network speaks, when it shares one ('mastodon-api',
  // 'atproto'). Metadata only — see deriveModule() for serving a family.
  // dialect: undefined,
  capabilities: linkedinCapabilities,
  create: deps => new LinkedinPlatform(deps),
  authValidator: new LinkedinAuthValidator(),
};

export { LinkedinPlatform } from './linkedin.platform.js';
export type {
  LinkedInAccountConfig,
  LinkedInExtra,
  LinkedinPlatformDeps,
} from './linkedin.platform.js';
export { LinkedinAuthValidator } from './linkedin-auth.validator.js';
export { LINKEDIN_VERSION, linkedinCapabilities } from './capabilities.js';
