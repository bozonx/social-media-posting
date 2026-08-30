/**
 * `@bozonx/social-posting-vimeo` — Vimeo support for `@bozonx/social-posting`.
 *
 * Register it by passing {@link vimeo} to `createPostingClient`.
 */
import type { PlatformModule } from '@bozonx/social-posting';
import { VimeoPlatform } from './vimeo.platform.js';
import { VimeoAuthValidator } from './vimeo-auth.validator.js';
import { vimeoCapabilities } from './capabilities.js';

/** The descriptor a host registers to publish to Vimeo. */
export const vimeo: PlatformModule = {
  name: 'vimeo',
  capabilities: vimeoCapabilities,
  create: deps => new VimeoPlatform(deps),
  authValidator: new VimeoAuthValidator(),
};

export { VimeoPlatform, PROCESSING_STEP } from './vimeo.platform.js';
export type { VimeoAccountConfig, VimeoExtra, VimeoPlatformDeps } from './vimeo.platform.js';
export { VimeoAuthValidator, validateVimeoAuth, UPLOAD_SCOPE } from './vimeo-auth.validator.js';
export {
  VimeoApi,
  videoIdOf,
  API_VERSION,
  DEFAULT_API_BASE_URL,
  TUS_VERSION,
} from './vimeo-api.js';
export type { VimeoVideo, VimeoUploadQuota } from './vimeo-api.js';
export { toPlatformError } from './vimeo-error.js';
export type { VimeoErrorBody } from './vimeo-error.js';
export {
  vimeoCapabilities,
  MAX_TITLE_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_TAGS,
  MAX_TAG_LENGTH,
  MAX_VIDEO_BYTES,
  MAX_PROCESSING_WAIT_SECS,
  CHUNK_SIZE_BYTES,
} from './capabilities.js';
