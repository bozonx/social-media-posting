/**
 * Public API for library mode
 * Main entry point for using social-media-posting-microservice as a library
 */

// Services
export { PostService } from './modules/post/post.service.js';
export { PreviewService } from './modules/post/preview.service.js';

// DTOs
export { PostRequestDto } from './modules/post/dto/post-request.dto.js';
export type { PostResponseDto, ErrorResponseDto } from './modules/post/dto/post-response.dto.js';
export type {
  PreviewResponseDto,
  PreviewErrorResponseDto,
} from './modules/post/dto/preview-response.dto.js';

// Enums
export { PostType } from './common/enums/post-type.enum.js';
export { BodyFormat } from './common/enums/body-format.enum.js';
export { ErrorCode } from './common/enums/error-code.enum.js';

// Types
export type { MediaInput, MediaInputObject, MediaType } from './common/types/media-input.type.js';

// Config types
export type { AppConfig } from './config/app.config.js';
export type { AccountConfig } from './modules/app-config/interfaces/app-config.interface.js';

// Library mode factory
export { createPostingClient } from './library.js';
export type { LibraryConfig, PostingClient } from './library.js';

// Logger interfaces
export type { ILogger } from './common/interfaces/logger.interface.js';
export { ConsoleLogger } from './common/interfaces/logger.interface.js';
