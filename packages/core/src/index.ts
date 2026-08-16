/**
 * `@bozonx/social-posting` — the framework-free core of the posting library.
 *
 * Two audiences: hosts that publish posts, and packages that implement a new
 * social network. Both are served from this single entry point.
 */

// Client
export { createPostingClient } from './client.js';
export type { PostingClient, PostingClientOptions } from './client.js';

// Services (for hosts assembling their own composition root)
export { PostService } from './services/post.service.js';
export { PreviewService } from './services/preview.service.js';
export { BasePostService } from './services/base-post.service.js';
export type { PostServiceDeps } from './services/base-post.service.js';

// Extension contract
export type { IPlatform, PlatformPublishResponse } from './platforms/platform.interface.js';
export type { IAuthValidator } from './platforms/auth-validator.interface.js';
export { PlatformRegistry } from './platforms/platform-registry.js';
export { AuthValidatorRegistry } from './platforms/auth-validator-registry.js';

// Request and result types
export type { PostRequest } from './types/post-request.js';
export type { PostResponse, ErrorResponse, PostResult } from './types/post-response.js';
export type {
  PreviewResponse,
  PreviewErrorResponse,
  PreviewResult,
} from './types/preview-response.js';
export type { MediaInput, MediaInputObject, MediaType } from './types/media-input.js';
export type { AccountConfig, ResolvedAccountConfig } from './types/account-config.js';

// Enums
export { PostType } from './types/post-type.js';
export { BodyFormat } from './types/body-format.js';
export { ErrorCode } from './errors/error-code.js';

// Errors
export { PostingError, ValidationError, AbortedError } from './errors/posting-error.js';

// Configuration
export { PostingConfig } from './config/posting-config.js';
export type { PostingConfigInput, LogLevel } from './config/posting-config.js';

// Helpers available to platform packages
export { MediaInputHelper } from './media/media-input.helper.js';
export { detectPrimaryMediaField } from './media/media-priority.js';
export { validateMediaUrl, validateMediaUrls } from './media/media-url.js';
export {
  validatePostRequest,
  assertValidPostRequest,
  MAX_BODY_LIMIT,
  MAX_MEDIA_SRC_LENGTH,
  MAX_TAGS,
  MAX_TAG_LENGTH,
  MAX_TITLE_LENGTH,
  MAX_DESCRIPTION_LENGTH,
} from './validation/validate-post-request.js';

// Logging
export type { ILogger } from './logger/logger.js';
export { ConsoleLogger } from './logger/logger.js';
