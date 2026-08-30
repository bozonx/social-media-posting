import type { PlatformModule } from '@bozonx/social-posting';
import { ThreadsPlatform } from './threads.platform.js';
import { ThreadsAuthValidator } from './threads-auth.validator.js';
import { threadsCapabilities } from './capabilities.js';
export const threads: PlatformModule = {
  name: 'threads',
  capabilities: threadsCapabilities,
  create: deps => new ThreadsPlatform(deps),
  authValidator: new ThreadsAuthValidator(),
};
export { ThreadsPlatform, DEFAULT_API_BASE_URL, CONTAINER_STEP } from './threads.platform.js';
export type {
  ThreadsExtra,
  ThreadsAccountConfig,
  ThreadsPlatformDeps,
} from './threads.platform.js';
export { ThreadsAuthValidator, REQUIRED_SCOPES } from './threads-auth.validator.js';
export {
  threadsCapabilities,
  GRAPH_API_VERSION,
  CONTAINER_LIFETIME_SECS,
  MAX_BODY_LENGTH,
} from './capabilities.js';
