/**
 * `@bozonx/social-posting` — the framework-free core of the posting library.
 */

// Client
export { createPostingClient } from './client.js';
export type {
  PostingClient,
  PostingClientOptions,
  DeleteCallOptions,
  PublishCallOptions,
  PreviewCallOptions,
} from './client.js';

// Platform module descriptor (read-only / registration types)
export type { PlatformModule, PlatformDeps } from './platforms/platform-module.js';
export { deriveModule } from './platforms/platform-module.js';
export type {
  ResolvedCapabilities,
  RuntimeCapabilities,
  ReconcileOutcome,
} from './platforms/platform.interface.js';
export type {
  PlatformCapabilities,
  QuotaState,
  PostTypeCapabilities,
  MediaConstraints,
  BodyLengthRule,
  RequestField,
  ToggleCapabilities,
  ExtraFieldSpec,
  RateLimits,
  CapabilitySource,
} from './platforms/capabilities.js';

// Request and result types
export type {
  PostRequest,
  PostSegment,
  PlatformObjectRef,
  PollInput,
  LocationInput,
  Visibility,
} from './types/post-request.js';

export type {
  Issue,
  PostPart,
  PostRef,
  ErrorPayload,
  PostResponse,
  ErrorResponse,
  PostResult,
  StatusResult,
  DeletePartResult,
  DeleteOutcome,
  DeleteResult,
} from './types/post-response.js';
export type { ResumeHandle, JsonValue, ResumeHandleViolation } from './types/resume-handle.js';
export { findResumeHandleSecrets, sanitizeResumeHandle } from './types/resume-handle.js';
export type { PreviewResult, AdaptedRequest } from './types/preview-response.js';
export type { PlatformTarget, TargetInput } from './types/target.js';
export { normalizeTarget, isValidTargetInput } from './types/target.js';
export type {
  ArticleDocument,
  ArticleBlock,
  ArticleBlockType,
  InlineNode,
  InlineMark,
} from './types/article-document.js';
export { ARTICLE_BLOCK_TYPES, INLINE_MARKS } from './types/article-document.js';
export type {
  MediaInput,
  MediaSourceInput,
  ThumbnailInput,
  MediaStreamFactory,
  MediaType,
} from './types/media-input.js';
export type { AccountConfig, ResolvedAccountConfig } from './types/account-config.js';

// Types & const objects
export {
  PostType,
  CANONICAL_POST_TYPES,
  isCanonicalPostType,
  isPlatformPostType,
} from './types/post-type.js';
export type { PostType as PostTypeValue } from './types/post-type.js';
export { BodyFormat } from './types/body-format.js';
export type { BodyFormat as BodyFormatValue } from './types/body-format.js';
export { ErrorCode } from './errors/error-code.js';

// Errors
export { PostingError, ValidationError, AbortedError } from './errors/posting-error.js';
export { PlatformError } from './errors/platform-error.js';
export type { PlatformErrorOptions } from './errors/platform-error.js';

// Credentials and OAuth2
export { StaticCredentialProvider, isAccessTokenExpired } from './auth/credentials.js';
export type { CredentialProvider, ResolvedCredentials } from './auth/credentials.js';

// Configuration
export { PostingConfig } from './config/posting-config.js';
export type { PostingConfigInput, LogLevel } from './config/posting-config.js';

// Validation sanity bounds
export {
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
