import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PostType, BodyFormat } from '../../../common/enums/index.js';
import type { MediaInput } from '../../../common/types/index.js';
import {
  IsMediaInput,
  IsMediaInputArray,
} from '../../../common/validators/media-input.validator.js';
import {
  IsValidBodyLength,
  MAX_BODY_LIMIT,
} from '../../../common/validators/body-length.validator.js';
import { IsChannelId } from '../../../common/validators/channel-id.validator.js';
import { HasContent } from '../../../common/validators/has-content.validator.js';

/**
 * Post request DTO
 * Contains all data needed to publish a post to a social media platform
 */
@HasContent()
export class PostRequestDto {
  /** Target social media platform (e.g., 'telegram') */
  @IsString()
  platform!: string;

  /** Post content/text body (optional if media is provided) */
  @IsOptional()
  @IsString()
  @IsValidBodyLength()
  body?: string;

  /** Post type (auto-detected if not specified) */
  @IsOptional()
  @IsEnum(PostType)
  type?: PostType = PostType.AUTO;

  /**
   * Format of the body content.
   * Standard values: 'text', 'html', 'md'
   * Platform-specific values (e.g., 'MarkdownV2' for Telegram) are also supported
   */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  bodyFormat?: string = 'text';

  /** Post title (used by platforms that support it, max 1000 characters) */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  title?: string;

  /** Post description/summary (used by platforms that support it, max 5000 characters) */
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  /** Cover image (for image posts or article thumbnails) */
  @IsOptional()
  @IsMediaInput()
  cover?: MediaInput;

  /** Video file (for video posts) */
  @IsOptional()
  @IsMediaInput()
  video?: MediaInput;

  /** Audio file (for audio posts) */
  @IsOptional()
  @IsMediaInput()
  audio?: MediaInput;

  /** Document file (for document posts) */
  @IsOptional()
  @IsMediaInput()
  document?: MediaInput;

  /** Multiple media files (for album/gallery posts) */
  @IsOptional()
  @IsMediaInputArray()
  media?: MediaInput[];

  /** Named account from configuration */
  @IsOptional()
  @IsString()
  account?: string;

  /** Platform-agnostic channel/chat identifier (e.g., @mychannel, -100123456789, or 123456789) */
  @IsOptional()
  @IsChannelId()
  channelId?: string | number;

  /** Inline authentication credentials (alternative to account) */
  @IsOptional()
  @IsObject()
  auth?: Record<string, any>;

  /** Platform-specific options */
  @IsOptional()
  @IsObject()
  options?: Record<string, any>;

  /** Disable notification (silent message) */
  @IsOptional()
  @IsBoolean()
  disableNotification?: boolean;

  /** Post tags/hashtags (max 200 items, each max 300 characters) */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  tags?: string[];

  /** Scheduled publication time (ISO 8601 format, max 50 characters) */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  scheduledAt?: string;

  /** Post language code (e.g., 'en', 'ru', max 50 characters) */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  postLanguage?: string;

  /** Publication mode: publish immediately or save as draft */
  @IsOptional()
  @IsEnum(['publish', 'draft'])
  mode?: 'publish' | 'draft';

  /** Idempotency key to prevent duplicate posts (max 1000 characters) */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  idempotencyKey?: string;

  /** Maximum body length override (max 500,000 characters) */
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(MAX_BODY_LIMIT)
  maxBody?: number;
}
