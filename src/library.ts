/**
 * Library mode factory
 * Provides standalone initialization without NestJS HTTP server
 */

import { Logger as NestLogger } from '@nestjs/common';
import { PostService } from './modules/post/post.service.js';
import { PreviewService } from './modules/post/preview.service.js';
import { PlatformRegistry } from './modules/platforms/base/platform-registry.service.js';
import { AuthValidatorRegistry } from './modules/platforms/base/auth-validator-registry.service.js';
import { IdempotencyService } from './modules/post/idempotency.service.js';
import { ShutdownService } from './common/services/shutdown.service.js';
import { LibraryConfigService } from './config/library.config.js';
import type {
  PostRequestDto,
  PostResponseDto,
  ErrorResponseDto,
} from './modules/post/dto/index.js';
import type { PreviewResponseDto, PreviewErrorResponseDto } from './modules/post/dto/index.js';
import type { AccountConfig } from './modules/app-config/interfaces/app-config.interface.js';
import { type ILogger, ConsoleLogger } from './common/interfaces/logger.interface.js';
import { TelegramPlatform } from './modules/platforms/telegram/telegram.platform.js';
import { TelegramAuthValidator } from './modules/platforms/telegram/telegram-auth.validator.js';
import { TelegramTypeDetector } from './modules/platforms/telegram/telegram-type-detector.service.js';
import { MediaService } from './modules/media/media.service.js';

/**
 * Configuration for library mode
 */
export interface LibraryConfig {
  /** Named account configurations */
  accounts: Record<string, AccountConfig>;
  /** Request timeout in seconds (default: 60) */
  requestTimeoutSecs?: number;
  /** Number of retry attempts on error (default: 3) */
  retryAttempts?: number;
  /** Delay between retry attempts in milliseconds (default: 1000) */
  retryDelayMs?: number;
  /** Time-to-live for idempotency records in minutes (default: 10) */
  idempotencyTtlMinutes?: number;
  /** Log level (default: 'warn') */
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
  /** Custom logger implementation (default: ConsoleLogger) */
  logger?: ILogger;
}

// function mapLogLevel ...
function mapLogLevel(level: string): any[] {
  // 'debug' | 'info' | 'warn' | 'error'
  switch (level) {
    case 'debug':
      return ['error', 'warn', 'log', 'debug'];
    case 'info':
      return ['error', 'warn', 'log'];
    case 'warn':
      return ['error', 'warn'];
    case 'error':
      return ['error'];
    default:
      return ['error', 'warn'];
  }
}

/**
 * Posting client interface
 * Main API for library usage
 */
export interface PostingClient {
  /**
   * Publish a post to a social media platform
   * @param request - Post request with platform, content, and media
   * @param abortSignal - Optional signal to abort the operation
   * @returns Success response with post details or error response
   */
  post(
    request: PostRequestDto,
    abortSignal?: AbortSignal,
  ): Promise<PostResponseDto | ErrorResponseDto>;

  /**
   * Preview a post without actually publishing it
   * @param request - Post request to preview
   * @returns Preview response with validation results or error response
   */
  preview(request: PostRequestDto): Promise<PreviewResponseDto | PreviewErrorResponseDto>;

  /**
   * Cleanup resources and shutdown gracefully
   */
  destroy(): Promise<void>;
}

/**
 * Create a posting client for library usage
 * Initializes all necessary services without NestJS HTTP server
 * @param config - Library configuration
 * @returns PostingClient instance ready to use
 */
export function createPostingClient(config: LibraryConfig): PostingClient {
  // Validate configuration happens in LibraryConfigService constructor
  // Use custom logger if provided, otherwise create ConsoleLogger
  const logLevel = config.logLevel ?? 'warn';
  const logger = config.logger ?? new ConsoleLogger(logLevel);

  // Override NestJS logger to use our custom logger
  // This ensures all NestJS services use the provided logger
  NestLogger.overrideLogger({
    log: (message: any, context?: string) =>
      logger.log(typeof message === 'object' ? JSON.stringify(message) : message, context),
    error: (message: any, trace?: string, context?: string) =>
      logger.error(typeof message === 'object' ? JSON.stringify(message) : message, trace, context),
    warn: (message: any, context?: string) =>
      logger.warn(typeof message === 'object' ? JSON.stringify(message) : message, context),
    debug: (message: any, context?: string) =>
      logger.debug(typeof message === 'object' ? JSON.stringify(message) : message, context),
    verbose: (message: any, context?: string) =>
      logger.log(typeof message === 'object' ? JSON.stringify(message) : message, context),
  });

  // Create app config service
  const appConfigService = new LibraryConfigService(config);

  // Create platform registry and auth validator registry (no constructor args)
  const platformRegistry = new PlatformRegistry();
  const authValidatorRegistry = new AuthValidatorRegistry();

  // Create platform dependencies
  const mediaService = new MediaService();
  const telegramTypeDetector = new TelegramTypeDetector();

  // Create platform instances
  const telegramPlatform = new TelegramPlatform(mediaService, telegramTypeDetector);
  const telegramAuthValidator = new TelegramAuthValidator();

  // Register platforms and auth validators
  platformRegistry.register(telegramPlatform);
  authValidatorRegistry.register(telegramAuthValidator);

  // Create shutdown service
  const shutdownService = new ShutdownService();

  // Create in-memory cache manager for idempotency
  const cacheManager = {
    async get<T>(key: string): Promise<T | undefined> {
      return undefined; // Fallback to in-memory implementation in IdempotencyService
    },
    async set(key: string, value: any, ttl?: number): Promise<void> {
      // No-op - IdempotencyService uses in-memory storage
    },
    async del(key: string): Promise<void> {
      // No-op
    },
    async reset(): Promise<void> {
      // No-op
    },
  };

  // Create idempotency service with mock cache manager
  const idempotencyService = new (IdempotencyService as any)(cacheManager, appConfigService);

  // Create main services
  const postService = new PostService(
    appConfigService,
    platformRegistry,
    authValidatorRegistry,
    idempotencyService,
    shutdownService,
  );

  const previewService = new PreviewService(
    appConfigService,
    platformRegistry,
    authValidatorRegistry,
  );

  // Return client interface
  return {
    async post(
      request: PostRequestDto,
      abortSignal?: AbortSignal,
    ): Promise<PostResponseDto | ErrorResponseDto> {
      return postService.publish(request, abortSignal);
    },

    async preview(request: PostRequestDto): Promise<PreviewResponseDto | PreviewErrorResponseDto> {
      return previewService.preview(request);
    },

    async destroy(): Promise<void> {
      // ShutdownService doesn't have a shutdown method, trigger lifecycle event manually
      await shutdownService.onApplicationShutdown('manual');
      shutdownService.onModuleDestroy();
    },
  };
}
