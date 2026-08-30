/**
 * `@bozonx/social-posting-dailymotion` — Dailymotion support for `@bozonx/social-posting`.
 *
 * Register it by passing {@link dailymotion} to `createPostingClient`.
 */
import type { PlatformModule } from '@bozonx/social-posting';
import { DailymotionPlatform } from './dailymotion.platform.js';
import { DailymotionAuthValidator } from './dailymotion-auth.validator.js';
import { dailymotionCapabilities } from './capabilities.js';

/** The descriptor a host registers to publish to Dailymotion. */
export const dailymotion: PlatformModule = {
  name: 'dailymotion',
  capabilities: dailymotionCapabilities,
  create: deps => new DailymotionPlatform(deps),
  authValidator: new DailymotionAuthValidator(),
};

export { DailymotionPlatform, PROCESSING_STEP } from './dailymotion.platform.js';
export type {
  DailymotionAccountConfig,
  DailymotionExtra,
  DailymotionPlatformDeps,
} from './dailymotion.platform.js';
export {
  DailymotionAuthValidator,
  validateDailymotionAuth,
  MANAGE_VIDEOS_SCOPE,
} from './dailymotion-auth.validator.js';
export { DailymotionApi, DEFAULT_API_BASE_URL, TOKEN_ENDPOINT } from './dailymotion-api.js';
export type { DailymotionVideo, UploadTicket, UploadedFile } from './dailymotion-api.js';
export { toPlatformError } from './dailymotion-error.js';
export type { DailymotionErrorBody } from './dailymotion-error.js';
export {
  dailymotionCapabilities,
  MAX_TITLE_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_TAGS,
  MAX_TAG_LENGTH,
  MAX_VIDEO_BYTES,
  MAX_VIDEO_DURATION_SECS,
  MAX_PROCESSING_WAIT_SECS,
} from './capabilities.js';
