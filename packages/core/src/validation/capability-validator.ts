import { PostType } from '../types/post-type.js';
import { MediaInputHelper } from '../media/media-input.helper.js';
import { validateMediaUrl } from '../media/media-url.js';
import { detectPostType } from './detect-post-type.js';
import { countBodyLength } from '../rendering/body.js';
import type { PostRequest } from '../types/post-request.js';
import type { PlatformCapabilities } from '../platforms/capabilities.js';

/** Every request field that can carry media. */
const MEDIA_FIELDS = ['cover', 'video', 'audio', 'document', 'media'] as const;
type MediaField = (typeof MEDIA_FIELDS)[number];

/** What a capability check found. */
export interface CapabilityValidation {
  /** The type the request will publish as. */
  detectedType: PostType;
  /** Blocking problems. */
  errors: string[];
  /** Non-blocking notes, including every field that will be dropped. */
  warnings: string[];
  /** Fields the platform will ignore, named individually. */
  ignoredFields: string[];
}

/** Extra checks a platform runs that no descriptor can express. */
export interface CapabilityValidationOptions {
  /** Platform-specific type detection, when the generic rules do not fit. */
  detectType?: (request: PostRequest) => PostType;
  /** Platform-specific rules; returns error messages. */
  validateExtra?: (request: PostRequest, detectedType: PostType) => string[];
}

function hasMedia(request: PostRequest, field: MediaField): boolean {
  return field === 'media'
    ? MediaInputHelper.isNotEmpty(request.media)
    : MediaInputHelper.isDefined(request[field]);
}

/**
 * Which media field a post type consumes, read from the type's required fields.
 * Everything else the request carries is dead weight for that type.
 */
function consumedMediaFields(capabilities: PlatformCapabilities, type: PostType): Set<MediaField> {
  const required = capabilities.postTypes?.[type]?.requiredFields ?? [];
  return new Set(MEDIA_FIELDS.filter(field => required.includes(field)));
}

/**
 * Check a request against what a platform says it accepts.
 *
 * This is the single implementation of the checks every network needs: which
 * types it takes, which fields each type requires or refuses, how long a body
 * may be, which formats it accepts, how many media items fit. A new network
 * contributes a descriptor, not another 150 lines of hand-written checks.
 *
 * @param request - The request to check.
 * @param capabilities - What the platform accepts.
 * @param options - Platform hooks for rules a descriptor cannot express.
 * @returns Errors, warnings, ignored fields and the detected post type.
 */
export function validateAgainstCapabilities(
  request: PostRequest,
  capabilities: PlatformCapabilities,
  options: CapabilityValidationOptions = {},
): CapabilityValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const ignoredFields: string[] = [];
  const label = capabilities.displayName ?? capabilities.name;

  const detectedType = (options.detectType ?? detectPostType)(request);

  if (!capabilities.supportedTypes.includes(detectedType)) {
    errors.push(`Post type '${detectedType}' is not supported for ${label}`);
    return { detectedType, errors, warnings, ignoredFields };
  }

  const typeRules = capabilities.postTypes?.[detectedType];

  for (const field of typeRules?.requiredFields ?? []) {
    if (!isPresent(request, field)) {
      errors.push(`Field '${field}' is required for type '${detectedType}'`);
    }
  }

  const forbiddenPresent = (typeRules?.forbiddenFields ?? []).filter(field =>
    isPresent(request, field),
  );
  if (forbiddenPresent.length > 0) {
    const allMedia = forbiddenPresent.every(field =>
      (MEDIA_FIELDS as readonly string[]).includes(field),
    );
    errors.push(
      allMedia
        ? `For type '${detectedType}', media fields must not be provided`
        : `For type '${detectedType}', fields ${forbiddenPresent.join(', ')} must not be provided`,
    );
  }

  errors.push(...validateMediaCount(request, detectedType, capabilities));
  errors.push(...validateMediaUrls(request));
  errors.push(...validateBody(request, capabilities));
  errors.push(...validateBodyFormat(request, capabilities));
  errors.push(...validateUnsupportedFeatures(request, capabilities, label));
  errors.push(...(options.validateExtra?.(request, detectedType) ?? []));

  // Anything the platform accepts but drops is named, never dropped in silence.
  const declaredIgnored = (capabilities.ignoredFields ?? []).filter(field =>
    isPresent(request, field),
  );
  if (declaredIgnored.length > 0) {
    ignoredFields.push(...declaredIgnored);
    warnings.push(
      `Fields ${declaredIgnored.join(', ')} are not used by ${label} and will be ignored`,
    );
  }

  const consumed = consumedMediaFields(capabilities, detectedType);
  const forbidden = new Set(typeRules?.forbiddenFields ?? []);
  const unusedMedia = MEDIA_FIELDS.filter(
    field => !consumed.has(field) && !forbidden.has(field) && hasMedia(request, field),
  );
  if (unusedMedia.length > 0) {
    ignoredFields.push(...unusedMedia);
    warnings.push(`Fields ${unusedMedia.join(', ')} will be ignored for type '${detectedType}'`);
  }

  return { detectedType, errors, warnings, ignoredFields };
}

function isPresent(request: PostRequest, field: string): boolean {
  if ((MEDIA_FIELDS as readonly string[]).includes(field)) {
    return hasMedia(request, field as MediaField);
  }
  const value = (request as unknown as Record<string, unknown>)[field];
  if (typeof value === 'string') {
    return value.trim().length > 0;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  return value !== undefined && value !== null && value !== false;
}

function validateMediaCount(
  request: PostRequest,
  type: PostType,
  capabilities: PlatformCapabilities,
): string[] {
  const rules = capabilities.postTypes?.[type];
  if (!rules || !Array.isArray(request.media)) {
    return [];
  }

  const errors: string[] = [];
  const count = request.media.length;

  if (rules.minMediaCount !== undefined && count < rules.minMediaCount) {
    errors.push(`Type '${type}' needs at least ${rules.minMediaCount} media item(s), got ${count}`);
  }
  if (rules.maxMediaCount !== undefined && count > rules.maxMediaCount) {
    errors.push(
      `Type '${type}' accepts at most ${rules.maxMediaCount} media item(s), got ${count}`,
    );
  }

  return errors;
}

function validateMediaUrls(request: PostRequest): string[] {
  const errors: string[] = [];
  const check = (media: unknown) => {
    const url = MediaInputHelper.getUrl(media as never);
    if (!url) {
      return;
    }
    try {
      validateMediaUrl(url);
    } catch (error) {
      errors.push((error as Error).message);
    }
  };

  for (const field of ['cover', 'video', 'audio', 'document'] as const) {
    if (request[field]) {
      check(request[field]);
    }
  }
  request.media?.forEach(check);

  return errors;
}

function validateBody(request: PostRequest, capabilities: PlatformCapabilities): string[] {
  if (!request.body || capabilities.maxBodyLength === undefined) {
    return [];
  }

  // A per-request cap can only be stricter than the platform's own.
  const limit = Math.min(request.maxBody ?? capabilities.maxBodyLength, capabilities.maxBodyLength);
  const length = countBodyLength(request.body, capabilities.bodyLengthRule);

  return length > limit
    ? [`Body length ${length} exceeds the ${limit} characters ${capabilities.name} accepts`]
    : [];
}

function validateBodyFormat(request: PostRequest, capabilities: PlatformCapabilities): string[] {
  const format = request.bodyFormat;
  if (!format || !capabilities.supportedBodyFormats) {
    return [];
  }

  return capabilities.supportedBodyFormats.includes(format)
    ? []
    : [
        `Body format '${format}' is not supported for ${capabilities.displayName ?? capabilities.name}; ` +
          `supported: ${capabilities.supportedBodyFormats.join(', ')}`,
      ];
}

/**
 * Refuse a field the platform cannot honour, rather than accepting it and
 * quietly doing something else. A contract that drops a field is worse than one
 * that rejects it.
 */
function validateUnsupportedFeatures(
  request: PostRequest,
  capabilities: PlatformCapabilities,
  label: string,
): string[] {
  const errors: string[] = [];

  if (request.scheduledAt && !capabilities.supportsNativeScheduling) {
    errors.push(
      `${label} cannot schedule posts, so 'scheduledAt' would be ignored. ` +
        'Schedule the call itself instead of passing this field.',
    );
  }

  if (request.mode === 'draft' && !capabilities.supportsDraft) {
    errors.push(`${label} has no drafts, so mode 'draft' cannot be honoured`);
  }

  if (capabilities.supportsSpoiler === false) {
    const spoiled = [
      request.cover,
      request.video,
      request.audio,
      request.document,
      ...(request.media ?? []),
    ].some(media => media && MediaInputHelper.getHasSpoiler(media));
    if (spoiled) {
      errors.push(`${label} has no spoilers, so 'hasSpoiler' cannot be honoured`);
    }
  }

  return errors;
}
