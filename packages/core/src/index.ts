/**
 * `@bozonx/social-posting` — the framework-free core of the posting library.
 *
 * Two audiences: hosts that publish posts, and packages that implement a new
 * social network. Both are served from this single entry point.
 */

// Client
export { createPostingClient } from './client.js';
export type {
  PostingClient,
  PostingClientOptions,
  DeleteCallOptions,
  PublishCallOptions,
} from './client.js';

// Services (for hosts assembling their own composition root)
export { PostService } from './services/post.service.js';
export { PreviewService } from './services/preview.service.js';
export { BasePostService } from './services/base-post.service.js';
export type { PostServiceDeps } from './services/base-post.service.js';

// Extension contract
export type {
  IPlatform,
  PlatformPublishResponse,
  PlatformStatusResponse,
  PublishOptions,
  DeleteOptions,
} from './platforms/platform.interface.js';
export type {
  IAuthValidator,
  AuthValidation,
  AuthValidationContext,
} from './platforms/auth-validator.interface.js';
export type { PlatformModule, PlatformDeps } from './platforms/platform-module.js';
export type {
  PlatformCapabilities,
  PostTypeCapabilities,
  MediaConstraints,
  BodyLengthRule,
  RequestField,
  ToggleCapabilities,
  ExtraFieldSpec,
  RateLimits,
} from './platforms/capabilities.js';
export { validateCapabilities } from './platforms/capabilities.js';
export { PlatformRegistry } from './platforms/platform-registry.js';
export { AuthValidatorRegistry } from './platforms/auth-validator-registry.js';

// Request and result types
export type {
  PostRequest,
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
export type { ResumeHandle, JsonValue } from './types/resume-handle.js';
export type { PreviewResult } from './types/preview-response.js';
export type {
  MediaInput,
  MediaSourceInput,
  ThumbnailInput,
  MediaStreamFactory,
  MediaType,
} from './types/media-input.js';
export type { AccountConfig, ResolvedAccountConfig } from './types/account-config.js';

// Types & const objects
export { PostType } from './types/post-type.js';
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
export { OAuth2TokenRefresher } from './auth/oauth2.js';
export type { OAuth2Config } from './auth/oauth2.js';

// Configuration
export { PostingConfig } from './config/posting-config.js';
export type { PostingConfigInput, LogLevel } from './config/posting-config.js';

// Media pipeline
export { MediaFetcher } from './media/media-fetcher.js';
export type { MediaMetadata, OpenedMedia, MediaFetcherOptions } from './media/media-fetcher.js';
export { toMediaSource, requiresByteUpload, knownSizeBytes } from './media/media-source.js';
export type {
  MediaSource,
  UrlMediaSource,
  BytesMediaSource,
  BlobMediaSource,
  StreamMediaSource,
  PlatformRefMediaSource,
} from './media/media-source.js';
export { sniffMimeType, mediaKindOf, SNIFF_BYTES } from './media/mime-sniffer.js';
export type { MediaKind } from './media/mime-sniffer.js';
export {
  runChunkedUpload,
  readResumePosition,
  DEFAULT_CHUNK_SIZE_BYTES,
  UPLOAD_STEP,
} from './media/chunked-uploader.js';
export type {
  ChunkedUploadDriver,
  ChunkedUploadOptions,
  ChunkContext,
  ResumePosition,
} from './media/chunked-uploader.js';

// Helpers available to platform packages
export { MediaInputHelper } from './media/media-input.helper.js';
export { detectPrimaryMediaField } from './media/media-priority.js';
export { validateMediaUrl } from './media/media-url.js';
export { validateAgainstCapabilities } from './validation/capability-validator.js';
export type {
  CapabilityValidation,
  CapabilityValidationOptions,
} from './validation/capability-validator.js';
export {
  previewFromCapabilities,
  renderBody,
  renderBodyWithTruncation,
  resolveBodyTargetFormat,
} from './validation/capability-preview.js';
export { detectPostType } from './validation/detect-post-type.js';
export {
  convertBody,
  countBodyLength,
  truncateBody,
  escapeHtml,
  escapeMarkdownV2,
  htmlToPlainText,
  markdownToHtml,
  markdownToPlainText,
} from './rendering/body.js';
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

// HTTP transport shared by platform packages
export { httpRequest } from './http/http-request.js';
export type { HttpRequestOptions } from './http/http-request.js';

// Logging
export type { ILogger } from './logger/logger.js';
export { ConsoleLogger } from './logger/logger.js';
