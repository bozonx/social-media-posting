import type { PlatformModule } from '@bozonx/social-posting';
import { InstagramPlatform } from './instagram.platform.js';
import { InstagramAuthValidator } from './instagram-auth.validator.js';
import { instagramCapabilities } from './capabilities.js';
export const instagram: PlatformModule = {
  name: 'instagram',
  capabilities: instagramCapabilities,
  create: deps => new InstagramPlatform(deps),
  authValidator: new InstagramAuthValidator(),
};
export { InstagramPlatform, DEFAULT_API_BASE_URL, CONTAINER_STEP } from './instagram.platform.js';
export type {
  InstagramExtra,
  InstagramAccountConfig,
  InstagramPlatformDeps,
} from './instagram.platform.js';
export { InstagramAuthValidator, REQUIRED_SCOPES } from './instagram-auth.validator.js';
export {
  instagramCapabilities,
  GRAPH_API_VERSION,
  CONTAINER_LIFETIME_SECS,
  MAX_BODY_LENGTH,
} from './capabilities.js';
