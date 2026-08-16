import type { PostRequest } from '../types/post-request.js';
import type { MediaInput } from '../types/media-input.js';
import { PostType } from '../types/post-type.js';
import { ValidationError } from '../errors/posting-error.js';

/** Absolute maximum body length in characters; `maxBody` can only lower it. */
export const MAX_BODY_LIMIT = 500_000;
/** Maximum length of a media `src` string (URL or platform reference). */
export const MAX_MEDIA_SRC_LENGTH = 500;
/** Maximum number of tags accepted on a single post. */
export const MAX_TAGS = 200;
/** Maximum length of a single tag. */
export const MAX_TAG_LENGTH = 300;
/** Maximum length of the optional post title. */
export const MAX_TITLE_LENGTH = 1000;
/** Maximum length of the optional post description. */
export const MAX_DESCRIPTION_LENGTH = 5000;

const POST_TYPES = new Set<string>(Object.values(PostType));
const MEDIA_TYPES = new Set(['image', 'video', 'audio', 'document']);
const MEDIA_FIELDS = ['cover', 'video', 'audio', 'document'] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateMediaInput(value: unknown, field: string, errors: string[]): void {
  if (!isPlainObject(value)) {
    errors.push(`Field '${field}' must be an object with a 'src' property`);
    return;
  }

  const { src, hasSpoiler, type } = value as Partial<MediaInput>;

  if (typeof src !== 'string' || src.length === 0) {
    errors.push(`Field '${field}.src' must be a non-empty string`);
  } else if (src.length > MAX_MEDIA_SRC_LENGTH) {
    errors.push(`Field '${field}.src' must not exceed ${MAX_MEDIA_SRC_LENGTH} characters`);
  }

  if (hasSpoiler !== undefined && typeof hasSpoiler !== 'boolean') {
    errors.push(`Field '${field}.hasSpoiler' must be a boolean`);
  }

  if (type !== undefined && (typeof type !== 'string' || !MEDIA_TYPES.has(type))) {
    errors.push(`Field '${field}.type' must be one of ${Array.from(MEDIA_TYPES).join(', ')}`);
  }
}

function validateOptionalString(
  value: unknown,
  field: string,
  maxLength: number,
  errors: string[],
): void {
  if (value === undefined) {
    return;
  }
  if (typeof value !== 'string') {
    errors.push(`Field '${field}' must be a string`);
    return;
  }
  if (value.length > maxLength) {
    errors.push(`Field '${field}' must not exceed ${maxLength} characters`);
  }
}

function hasAnyContent(request: PostRequest): boolean {
  const hasBody = typeof request.body === 'string' && request.body.trim().length > 0;
  const hasMedia =
    MEDIA_FIELDS.some(field => isPlainObject(request[field])) ||
    (Array.isArray(request.media) && request.media.length > 0);
  return hasBody || hasMedia;
}

/**
 * Structural validation of a post request: the minimum every platform relies on.
 *
 * Platform-specific rules (which fields a given post type requires, which media
 * formats are accepted, how long a body may be on that network) belong to the
 * platform's capability descriptor, not here.
 *
 * @param request - Request to validate.
 * @returns Validation messages; an empty array means the request is structurally sound.
 */
export function validatePostRequest(request: PostRequest): string[] {
  const errors: string[] = [];

  if (!isPlainObject(request)) {
    return ['Post request must be an object'];
  }

  if (typeof request.platform !== 'string' || request.platform.trim().length === 0) {
    errors.push("Field 'platform' is required and must be a non-empty string");
  }

  if (request.body !== undefined) {
    if (typeof request.body !== 'string') {
      errors.push("Field 'body' must be a string");
    } else {
      const maxBody = Math.min(request.maxBody ?? MAX_BODY_LIMIT, MAX_BODY_LIMIT);
      if (request.body.length > maxBody) {
        errors.push(`Body length must not exceed ${maxBody} characters`);
      }
    }
  }

  if (request.maxBody !== undefined) {
    if (
      typeof request.maxBody !== 'number' ||
      !Number.isFinite(request.maxBody) ||
      request.maxBody < 1 ||
      request.maxBody > MAX_BODY_LIMIT
    ) {
      errors.push(`Field 'maxBody' must be a number between 1 and ${MAX_BODY_LIMIT}`);
    }
  }

  if (request.type !== undefined && !POST_TYPES.has(request.type)) {
    errors.push(`Field 'type' must be one of ${Array.from(POST_TYPES).join(', ')}`);
  }

  validateOptionalString(request.bodyFormat, 'bodyFormat', 50, errors);
  validateOptionalString(request.title, 'title', MAX_TITLE_LENGTH, errors);
  validateOptionalString(request.description, 'description', MAX_DESCRIPTION_LENGTH, errors);
  validateOptionalString(request.account, 'account', 1000, errors);
  validateOptionalString(request.scheduledAt, 'scheduledAt', 50, errors);
  validateOptionalString(request.postLanguage, 'postLanguage', 50, errors);

  for (const field of MEDIA_FIELDS) {
    const value: unknown = request[field];
    if (value !== undefined && value !== null && value !== false) {
      validateMediaInput(value, field, errors);
    }
  }

  if (request.media !== undefined) {
    if (!Array.isArray(request.media)) {
      errors.push("Field 'media' must be an array of media objects");
    } else {
      request.media.forEach((item, index) => validateMediaInput(item, `media[${index}]`, errors));
    }
  }

  if (request.channelId !== undefined && request.channelId !== null) {
    const { channelId } = request;
    const validString = typeof channelId === 'string' && channelId.trim().length > 0;
    const validNumber = typeof channelId === 'number' && Number.isInteger(channelId);
    if (!validString && !validNumber) {
      errors.push("Field 'channelId' must be a non-empty string or an integer number");
    }
  }

  if (request.auth !== undefined && !isPlainObject(request.auth)) {
    errors.push("Field 'auth' must be an object");
  }

  if (request.options !== undefined && !isPlainObject(request.options)) {
    errors.push("Field 'options' must be an object");
  }

  if (
    request.disableNotification !== undefined &&
    typeof request.disableNotification !== 'boolean'
  ) {
    errors.push("Field 'disableNotification' must be a boolean");
  }

  if (request.tags !== undefined) {
    if (!Array.isArray(request.tags)) {
      errors.push("Field 'tags' must be an array of strings");
    } else {
      if (request.tags.length > MAX_TAGS) {
        errors.push(`Field 'tags' must not contain more than ${MAX_TAGS} items`);
      }
      const invalid = request.tags.some(
        tag => typeof tag !== 'string' || tag.length > MAX_TAG_LENGTH,
      );
      if (invalid) {
        errors.push(`Each tag must be a string of at most ${MAX_TAG_LENGTH} characters`);
      }
    }
  }

  if (request.mode !== undefined && request.mode !== 'publish' && request.mode !== 'draft') {
    errors.push("Field 'mode' must be either 'publish' or 'draft'");
  }

  if (!hasAnyContent(request)) {
    errors.push(
      'Post must have either body text or at least one media field (cover, video, audio, document, or media)',
    );
  }

  return errors;
}

/**
 * Validate a post request and throw when it is not structurally sound.
 * @param request - Request to validate.
 * @throws ValidationError carrying every message at once.
 */
export function assertValidPostRequest(request: PostRequest): void {
  const errors = validatePostRequest(request);
  if (errors.length > 0) {
    throw new ValidationError(errors);
  }
}
