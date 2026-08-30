/**
 * `@bozonx/social-posting-youtube` — YouTube support for `@bozonx/social-posting`.
 *
 * Register it by passing {@link youtube} to `createPostingClient`.
 */
import type { PlatformModule } from '@bozonx/social-posting';
import { YouTubePlatform } from './youtube.platform.js';
import { YouTubeAuthValidator } from './youtube-auth.validator.js';
import { youtubeCapabilities } from './capabilities.js';

/** The descriptor a host registers to publish to YouTube. */
export const youtube: PlatformModule = {
  name: 'youtube',
  capabilities: youtubeCapabilities,
  create: deps => new YouTubePlatform(deps),
  authValidator: new YouTubeAuthValidator(),
};

export { YouTubePlatform, GOOGLE_TOKEN_ENDPOINT, PROCESSING_STEP } from './youtube.platform.js';
export type {
  YouTubeAccountConfig,
  YouTubeExtra,
  YouTubePlatformDeps,
} from './youtube.platform.js';
export {
  YouTubeAuthValidator,
  validateYouTubeAuth,
  UPLOAD_SCOPE,
  MANAGE_SCOPE,
  READONLY_SCOPE,
} from './youtube-auth.validator.js';
export { YouTubeApi, API_VERSION, DEFAULT_API_BASE_URL } from './youtube-api.js';
export type { YouTubeVideo, YouTubeVideoListResponse, ResumableSession } from './youtube-api.js';
export { toPlatformError } from './youtube-error.js';
export type { YouTubeErrorBody, GoogleErrorItem } from './youtube-error.js';
export {
  youtubeCapabilities,
  MAX_TITLE_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_TAG_LENGTH,
  MAX_TAGS_LENGTH,
  MAX_VIDEO_BYTES,
  MAX_VIDEO_DURATION_SECS,
  MAX_THUMBNAIL_BYTES,
  MAX_PROCESSING_WAIT_SECS,
  UPLOAD_QUOTA_UNITS,
  DEFAULT_DAILY_QUOTA_UNITS,
  CHUNK_SIZE_BYTES,
  DEFAULT_CATEGORY_ID,
} from './capabilities.js';
