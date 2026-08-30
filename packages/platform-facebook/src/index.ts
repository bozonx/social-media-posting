import type { PlatformModule } from '@bozonx/social-posting';
import { FacebookPlatform } from './facebook.platform.js';
import { FacebookAuthValidator } from './facebook-auth.validator.js';
import { facebookCapabilities } from './capabilities.js';
export const facebook: PlatformModule = {
  name: 'facebook',
  capabilities: facebookCapabilities,
  create: deps => new FacebookPlatform(deps),
  authValidator: new FacebookAuthValidator(),
};
export { FacebookPlatform, DEFAULT_API_BASE_URL, REEL_STEP } from './facebook.platform.js';
export type {
  FacebookExtra,
  FacebookAccountConfig,
  FacebookPlatformDeps,
} from './facebook.platform.js';
export { FacebookAuthValidator, REQUIRED_SCOPES } from './facebook-auth.validator.js';
export {
  facebookCapabilities,
  GRAPH_API_VERSION,
  MAX_BODY_LENGTH,
  VIDEO_CONTAINER_LIFETIME_SECS,
} from './capabilities.js';
