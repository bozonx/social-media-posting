/**
 * `@bozonx/social-posting/platform` — Extension seams and utilities for platform adapters.
 */

// Extension contracts
export type {
  IPlatform,
  PlatformPublishResponse,
  PlatformStatusResponse,
  PublishOptions,
  DeleteOptions,
} from './platforms/platform.interface.js';
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
  CapabilitySource,
} from './platforms/capabilities.js';
export { validateCapabilities } from './platforms/capabilities.js';
export { PlatformRegistry } from './platforms/platform-registry.js';
export { AuthValidatorRegistry } from './platforms/auth-validator-registry.js';

// Errors for platform authors
export { PlatformError } from './errors/platform-error.js';
export type { PlatformErrorOptions } from './errors/platform-error.js';

// OAuth2
export { OAuth2TokenRefresher } from './auth/oauth2.js';
export type { OAuth2Config } from './auth/oauth2.js';

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

// Validation & rendering helpers for adapters
export { MediaInputHelper } from './media/media-input.helper.js';
export { detectPrimaryMediaField, detectItemMediaKind } from './media/media-priority.js';
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
  truncateHtml,
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

// HTTP transport
export { httpRequest } from './http/http-request.js';
export type { HttpRequestOptions } from './http/http-request.js';

// Services (for hosts assembling custom pipelines)
export { PostService } from './services/post.service.js';
export { PreviewService } from './services/preview.service.js';
export { BasePostService } from './services/base-post.service.js';
export type { PostServiceDeps } from './services/base-post.service.js';
