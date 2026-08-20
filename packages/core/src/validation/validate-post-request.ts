import type {
  PostRequest,
  LocationInput,
  PollInput,
  PlatformObjectRef,
} from '../types/post-request.js';
import type { MediaInput } from '../types/media-input.js';
import type { Issue } from '../types/post-response.js';
import { PostType } from '../types/post-type.js';
import { ValidationError } from '../errors/posting-error.js';

/** Absolute maximum body length in characters. */
export const MAX_BODY_LIMIT = 500_000;
/** Maximum length of a media `src` / URL string. */
export const MAX_MEDIA_SRC_LENGTH = 2048;
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
const MEDIA_SOURCE_KINDS = new Set(['url', 'bytes', 'blob', 'stream', 'platformRef']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateMediaInput(
  value: unknown,
  field: string,
  issues: Issue[],
  isThumbnail = false,
): void {
  if (!isPlainObject(value)) {
    issues.push({
      code: 'INVALID_FIELD_TYPE',
      field,
      message: `Field '${field}' must be a media object`,
    });
    return;
  }

  const media = value as Partial<MediaInput>;

  if (!isPlainObject(media.source)) {
    issues.push({
      code: 'INVALID_MEDIA_SOURCE',
      field: `${field}.source`,
      message: `Field '${field}.source' must be an object`,
    });
  } else {
    const { kind } = media.source;
    if (typeof kind !== 'string' || !MEDIA_SOURCE_KINDS.has(kind)) {
      issues.push({
        code: 'INVALID_MEDIA_SOURCE_KIND',
        field: `${field}.source.kind`,
        message: `Field '${field}.source.kind' must be one of: ${Array.from(MEDIA_SOURCE_KINDS).join(', ')}`,
      });
    } else {
      switch (kind) {
        case 'url':
          if (typeof media.source.url !== 'string' || media.source.url.trim().length === 0) {
            issues.push({
              code: 'INVALID_MEDIA_URL',
              field: `${field}.source.url`,
              message: `Field '${field}.source.url' must be a non-empty string`,
            });
          } else if (media.source.url.length > MAX_MEDIA_SRC_LENGTH) {
            issues.push({
              code: 'FIELD_TOO_LONG',
              field: `${field}.source.url`,
              message: `Field '${field}.source.url' must not exceed ${MAX_MEDIA_SRC_LENGTH} characters`,
            });
          }
          break;
        case 'bytes':
          if (!(media.source.bytes instanceof Uint8Array)) {
            issues.push({
              code: 'INVALID_MEDIA_BYTES',
              field: `${field}.source.bytes`,
              message: `Field '${field}.source.bytes' must be a Uint8Array`,
            });
          }
          break;
        case 'blob':
          if (typeof Blob !== 'undefined' && !(media.source.blob instanceof Blob)) {
            issues.push({
              code: 'INVALID_MEDIA_BLOB',
              field: `${field}.source.blob`,
              message: `Field '${field}.source.blob' must be a Blob`,
            });
          }
          break;

        case 'stream':
          if (typeof media.source.open !== 'function') {
            issues.push({
              code: 'INVALID_MEDIA_STREAM',
              field: `${field}.source.open`,
              message: `Field '${field}.source.open' must be a stream factory function`,
            });
          }
          break;
        case 'platformRef':
          if (typeof media.source.ref !== 'string' || media.source.ref.trim().length === 0) {
            issues.push({
              code: 'INVALID_MEDIA_REF',
              field: `${field}.source.ref`,
              message: `Field '${field}.source.ref' must be a non-empty string`,
            });
          }
          break;
      }
    }
  }

  if (
    media.type !== undefined &&
    (typeof media.type !== 'string' || !MEDIA_TYPES.has(media.type))
  ) {
    issues.push({
      code: 'INVALID_MEDIA_TYPE',
      field: `${field}.type`,
      message: `Field '${field}.type' must be one of ${Array.from(MEDIA_TYPES).join(', ')}`,
    });
  }

  if (media.sensitive !== undefined && typeof media.sensitive !== 'boolean') {
    issues.push({
      code: 'INVALID_FIELD_TYPE',
      field: `${field}.sensitive`,
      message: `Field '${field}.sensitive' must be a boolean`,
    });
  }

  if (media.altText !== undefined && typeof media.altText !== 'string') {
    issues.push({
      code: 'INVALID_FIELD_TYPE',
      field: `${field}.altText`,
      message: `Field '${field}.altText' must be a string`,
    });
  }

  validateNonNegativeNumber(media.durationSecs, `${field}.durationSecs`, issues);
  validatePositiveInteger(media.width, `${field}.width`, issues);
  validatePositiveInteger(media.height, `${field}.height`, issues);
  if ((media.width === undefined) !== (media.height === undefined)) {
    issues.push({
      code: 'DIMENSIONS_MISMATCH',
      field: `${field}.dimensions`,
      message: `Fields '${field}.width' and '${field}.height' must be provided together`,
    });
  }

  if (media.thumbnail !== undefined) {
    if (isThumbnail) {
      issues.push({
        code: 'RECURSIVE_THUMBNAIL',
        field: `${field}.thumbnail`,
        message: 'A thumbnail cannot recursively contain another thumbnail',
      });
    } else {
      validateMediaInput(media.thumbnail, `${field}.thumbnail`, issues, true);
    }
  }
}

function validateNonNegativeNumber(value: unknown, field: string, issues: Issue[]): void {
  if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) {
    issues.push({
      code: 'INVALID_FIELD_TYPE',
      field,
      message: `Field '${field}' must be a finite non-negative number`,
    });
  }
}

function validatePositiveInteger(value: unknown, field: string, issues: Issue[]): void {
  if (value !== undefined && (typeof value !== 'number' || !Number.isInteger(value) || value < 1)) {
    issues.push({
      code: 'INVALID_FIELD_TYPE',
      field,
      message: `Field '${field}' must be a positive integer`,
    });
  }
}

function validateOptionalString(
  value: unknown,
  field: string,
  maxLength: number,
  issues: Issue[],
): void {
  if (value === undefined) {
    return;
  }
  if (typeof value !== 'string') {
    issues.push({
      code: 'INVALID_FIELD_TYPE',
      field,
      message: `Field '${field}' must be a string`,
    });
    return;
  }
  if (value.length > maxLength) {
    issues.push({
      code: 'FIELD_TOO_LONG',
      field,
      message: `Field '${field}' must not exceed ${maxLength} characters`,
      params: { maxLength, actualLength: value.length },
    });
  }
}

function validateLocation(location: unknown, issues: Issue[]): void {
  if (!isPlainObject(location)) {
    issues.push({
      code: 'INVALID_FIELD_TYPE',
      field: 'location',
      message: "Field 'location' must be an object",
    });
    return;
  }

  const loc = location as Partial<LocationInput>;
  const hasCoords = loc.latitude !== undefined || loc.longitude !== undefined;
  const hasPlaceId = loc.placeId !== undefined;

  if (hasCoords && hasPlaceId) {
    issues.push({
      code: 'INVALID_LOCATION',
      field: 'location',
      message: "Field 'location' must specify either coordinates or placeId, not both",
    });
  } else if (!hasCoords && !hasPlaceId) {
    issues.push({
      code: 'INVALID_LOCATION',
      field: 'location',
      message: "Field 'location' must specify either coordinates or placeId",
    });
  } else if (hasCoords) {
    if (
      typeof loc.latitude !== 'number' ||
      !Number.isFinite(loc.latitude) ||
      loc.latitude < -90 ||
      loc.latitude > 90
    ) {
      issues.push({
        code: 'INVALID_LOCATION_COORDINATES',
        field: 'location.latitude',
        message: "Field 'location.latitude' must be a number between -90 and 90",
      });
    }
    if (
      typeof loc.longitude !== 'number' ||
      !Number.isFinite(loc.longitude) ||
      loc.longitude < -180 ||
      loc.longitude > 180
    ) {
      issues.push({
        code: 'INVALID_LOCATION_COORDINATES',
        field: 'location.longitude',
        message: "Field 'location.longitude' must be a number between -180 and 180",
      });
    }
  } else if (hasPlaceId) {
    if (typeof loc.placeId !== 'string' || loc.placeId.trim().length === 0) {
      issues.push({
        code: 'INVALID_LOCATION_PLACE_ID',
        field: 'location.placeId',
        message: "Field 'location.placeId' must be a non-empty string",
      });
    }
  }
}

function validatePoll(poll: unknown, issues: Issue[]): void {
  if (!isPlainObject(poll)) {
    issues.push({
      code: 'INVALID_FIELD_TYPE',
      field: 'poll',
      message: "Field 'poll' must be an object",
    });
    return;
  }

  const p = poll as Partial<PollInput>;
  if (!Array.isArray(p.options) || p.options.length < 2) {
    issues.push({
      code: 'INVALID_POLL_OPTIONS',
      field: 'poll.options',
      message: "Field 'poll.options' must be an array of at least 2 options",
    });
  } else if (p.options.some(opt => typeof opt !== 'string' || opt.trim().length === 0)) {
    issues.push({
      code: 'INVALID_POLL_OPTIONS',
      field: 'poll.options',
      message: "Each option in 'poll.options' must be a non-empty string",
    });
  }

  validateNonNegativeNumber(p.durationSecs, 'poll.durationSecs', issues);
}

function validateObjectRef(ref: unknown, field: string, issues: Issue[]): void {
  if (!isPlainObject(ref)) {
    issues.push({
      code: 'INVALID_FIELD_TYPE',
      field,
      message: `Field '${field}' must be an object`,
    });
    return;
  }

  const r = ref as Partial<PlatformObjectRef>;
  if (typeof r.id !== 'string' || r.id.trim().length === 0) {
    issues.push({
      code: 'FIELD_REQUIRED',
      field: `${field}.id`,
      message: `Field '${field}.id' is required and must be a non-empty string`,
    });
  }
}

function hasAnyContent(request: PostRequest): boolean {
  const hasBody = typeof request.body === 'string' && request.body.trim().length > 0;
  const hasMedia = Array.isArray(request.media) && request.media.length > 0;
  const hasThumbnail = isPlainObject(request.thumbnail);
  const hasPoll = isPlainObject(request.poll);
  const hasLocation = isPlainObject(request.location);
  const hasRepost = isPlainObject(request.repostOf);
  const hasReply = isPlainObject(request.inReplyTo);

  return hasBody || hasMedia || hasThumbnail || hasPoll || hasLocation || hasRepost || hasReply;
}

/**
 * Structural validation of a post request: the minimum every platform relies on.
 *
 * @param request - Request to validate.
 * @returns Validation issues; an empty array means the request is structurally sound.
 */
export function validatePostRequest(request: PostRequest): Issue[] {
  const issues: Issue[] = [];

  if (!isPlainObject(request)) {
    return [
      {
        code: 'INVALID_REQUEST_BODY',
        message: 'Post request must be an object',
      },
    ];
  }

  if (typeof request.platform !== 'string' || request.platform.trim().length === 0) {
    issues.push({
      code: 'FIELD_REQUIRED',
      field: 'platform',
      message: "Field 'platform' is required and must be a non-empty string",
    });
  }

  if (request.body !== undefined) {
    if (typeof request.body !== 'string') {
      issues.push({
        code: 'INVALID_FIELD_TYPE',
        field: 'body',
        message: "Field 'body' must be a string",
      });
    } else if (request.body.length > MAX_BODY_LIMIT) {
      issues.push({
        code: 'BODY_TOO_LONG',
        field: 'body',
        message: `Body length must not exceed ${MAX_BODY_LIMIT} characters`,
        params: { maxLength: MAX_BODY_LIMIT, actualLength: request.body.length },
      });
    }
  }

  if (request.type !== undefined) {
    if (
      typeof request.type !== 'string' ||
      (!POST_TYPES.has(request.type) && request.type.trim().length === 0)
    ) {
      issues.push({
        code: 'INVALID_POST_TYPE',
        field: 'type',
        message: `Field 'type' must be one of ${Array.from(POST_TYPES).join(', ')} or a platform-defined type`,
      });
    }
  }

  validateOptionalString(request.bodyFormat, 'bodyFormat', 50, issues);
  validateOptionalString(request.title, 'title', MAX_TITLE_LENGTH, issues);
  validateOptionalString(request.description, 'description', MAX_DESCRIPTION_LENGTH, issues);
  validateOptionalString(request.account, 'account', 1000, issues);
  validateOptionalString(request.scheduledAt, 'scheduledAt', 50, issues);
  validateOptionalString(request.language, 'language', 50, issues);
  validateOptionalString(request.contentWarning, 'contentWarning', MAX_DESCRIPTION_LENGTH, issues);
  validateOptionalString(request.idempotencyKey, 'idempotencyKey', 500, issues);

  if (request.target !== undefined) {
    const validString = typeof request.target === 'string' && request.target.trim().length > 0;
    const validNumber = typeof request.target === 'number' && Number.isInteger(request.target);
    if (!validString && !validNumber) {
      issues.push({
        code: 'INVALID_FIELD_TYPE',
        field: 'target',
        message: "Field 'target' must be a non-empty string or an integer number",
      });
    }
  }

  if (request.auth !== undefined && !isPlainObject(request.auth)) {
    issues.push({
      code: 'INVALID_FIELD_TYPE',
      field: 'auth',
      message: "Field 'auth' must be an object",
    });
  }

  if (request.extra !== undefined && !isPlainObject(request.extra)) {
    issues.push({
      code: 'INVALID_FIELD_TYPE',
      field: 'extra',
      message: "Field 'extra' must be an object",
    });
  }

  if (request.silent !== undefined && typeof request.silent !== 'boolean') {
    issues.push({
      code: 'INVALID_FIELD_TYPE',
      field: 'silent',
      message: "Field 'silent' must be a boolean",
    });
  }

  if (request.sensitive !== undefined && typeof request.sensitive !== 'boolean') {
    issues.push({
      code: 'INVALID_FIELD_TYPE',
      field: 'sensitive',
      message: "Field 'sensitive' must be a boolean",
    });
  }

  if (request.commentsEnabled !== undefined && typeof request.commentsEnabled !== 'boolean') {
    issues.push({
      code: 'INVALID_FIELD_TYPE',
      field: 'commentsEnabled',
      message: "Field 'commentsEnabled' must be a boolean",
    });
  }

  if (request.media !== undefined) {
    if (!Array.isArray(request.media)) {
      issues.push({
        code: 'INVALID_FIELD_TYPE',
        field: 'media',
        message: "Field 'media' must be an array of media objects",
      });
    } else {
      request.media.forEach((item, index) => validateMediaInput(item, `media[${index}]`, issues));
    }
  }

  if (request.thumbnail !== undefined) {
    validateMediaInput(request.thumbnail, 'thumbnail', issues, true);
  }

  if (request.tags !== undefined) {
    if (!Array.isArray(request.tags)) {
      issues.push({
        code: 'INVALID_FIELD_TYPE',
        field: 'tags',
        message: "Field 'tags' must be an array of strings",
      });
    } else {
      if (request.tags.length > MAX_TAGS) {
        issues.push({
          code: 'ARRAY_TOO_LARGE',
          field: 'tags',
          message: `Field 'tags' must not contain more than ${MAX_TAGS} items`,
        });
      }
      const invalid = request.tags.some(
        tag => typeof tag !== 'string' || tag.length > MAX_TAG_LENGTH,
      );
      if (invalid) {
        issues.push({
          code: 'INVALID_TAG',
          field: 'tags',
          message: `Each tag must be a string of at most ${MAX_TAG_LENGTH} characters`,
        });
      }
    }
  }

  if (
    request.mode !== undefined &&
    (request.mode as string) !== 'publish' &&
    (request.mode as string) !== 'draft'
  ) {
    issues.push({
      code: 'INVALID_FIELD_VALUE',
      field: 'mode',
      message: "Field 'mode' must be either 'publish' or 'draft'",
    });
  }

  if (request.location !== undefined) {
    validateLocation(request.location, issues);
  }

  if (request.poll !== undefined) {
    validatePoll(request.poll, issues);
  }

  if (request.inReplyTo !== undefined) {
    validateObjectRef(request.inReplyTo, 'inReplyTo', issues);
  }

  if (request.repostOf !== undefined) {
    validateObjectRef(request.repostOf, 'repostOf', issues);
  }

  if (!hasAnyContent(request)) {
    issues.push({
      code: 'EMPTY_POST_REQUEST',
      message: 'Post must have either body text, media, poll, location, repostOf, or reply',
    });
  }

  return issues;
}

/**
 * Validate a post request and throw when it is not structurally sound.
 * @param request - Request to validate.
 * @throws ValidationError carrying every issue at once.
 */
export function assertValidPostRequest(request: PostRequest): void {
  const issues = validatePostRequest(request);
  if (issues.length > 0) {
    throw new ValidationError(issues);
  }
}
