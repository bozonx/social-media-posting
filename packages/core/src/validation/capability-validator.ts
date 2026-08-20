import type { PostType } from '../types/post-type.js';
import { detectPostType } from './detect-post-type.js';
import { detectItemMediaKind } from '../media/media-priority.js';
import { countBodyLength } from '../rendering/body.js';

import type { PostRequest } from '../types/post-request.js';
import type {
  PlatformCapabilities,
  RequestField,
  ExtraFieldSpec,
} from '../platforms/capabilities.js';
import type { MediaInput, MediaType } from '../types/media-input.js';
import type { Issue } from '../types/post-response.js';

/** What a capability check found. */
export interface CapabilityValidation {
  /** The type the request will publish as. */
  detectedType: PostType;
  /** Blocking problems. */
  issues: Issue[];
  /** Non-blocking notes, including every field that will be dropped. */
  warnings: Issue[];
  /** Fields the platform will ignore, named individually. */
  ignoredFields: RequestField[];
  /** String error messages for convenience. */
  errors: string[];
}

/** Extra checks a platform runs that no descriptor can express. */
export interface CapabilityValidationOptions {
  /** Platform-specific type detection, when the generic rules do not fit. */
  detectType?: (request: PostRequest) => PostType;
  /** Platform-specific rules; returns issues or error messages. */
  validateExtra?: (request: PostRequest, detectedType: PostType) => Issue[] | string[];
}

export function isFieldPresent(request: PostRequest, field: RequestField): boolean {
  switch (field) {
    case 'body':
      return typeof request.body === 'string' && request.body.trim().length > 0;
    case 'title':
      return typeof request.title === 'string' && request.title.trim().length > 0;
    case 'description':
      return typeof request.description === 'string' && request.description.trim().length > 0;
    case 'language':
      return typeof request.language === 'string' && request.language.trim().length > 0;
    case 'tags':
      return Array.isArray(request.tags) && request.tags.length > 0;
    case 'media':
      return Array.isArray(request.media) && request.media.length > 0;
    case 'thumbnail':
      return request.thumbnail !== undefined;
    case 'visibility':
      return request.visibility !== undefined && request.visibility !== '';
    case 'contentWarning':
      return typeof request.contentWarning === 'string' && request.contentWarning.trim().length > 0;
    case 'sensitive':
      return request.sensitive !== undefined;
    case 'commentsEnabled':
      return request.commentsEnabled !== undefined;
    case 'inReplyTo':
      return request.inReplyTo !== undefined;
    case 'repostOf':
      return request.repostOf !== undefined;
    case 'poll':
      return request.poll !== undefined;
    case 'location':
      return request.location !== undefined;
    case 'scheduledAt':
      return typeof request.scheduledAt === 'string' && request.scheduledAt.trim().length > 0;
    case 'mode':
      return request.mode !== undefined;
    default:
      return false;
  }
}

/**
 * Check a request against what a platform says it accepts.
 *
 * @param request - The request to check.
 * @param capabilities - What the platform accepts.
 * @param options - Platform hooks for rules a descriptor cannot express.
 * @returns Issues, warnings, ignored fields and the detected post type.
 */
export function validateAgainstCapabilities(
  request: PostRequest,
  capabilities: PlatformCapabilities,
  options: CapabilityValidationOptions = {},
): CapabilityValidation {
  const issues: Issue[] = [];
  const warnings: Issue[] = [];
  const ignoredFields: RequestField[] = [];
  const label = capabilities.displayName ?? capabilities.name;

  const detectedType = (options.detectType ?? detectPostType)(request);
  const supportedTypes = Object.keys(capabilities.postTypes) as PostType[];

  if (!supportedTypes.includes(detectedType)) {
    issues.push({
      code: 'POST_TYPE_UNSUPPORTED',
      field: 'type',
      message: `Post type '${detectedType}' is not supported for ${label}`,
    });
    return {
      detectedType,
      issues,
      warnings,
      ignoredFields,
      errors: issues.map(i => i.message),
    };
  }

  const typeRules = capabilities.postTypes[detectedType];

  for (const field of typeRules?.requiredFields ?? []) {
    if (!isFieldPresent(request, field)) {
      issues.push({
        code: 'FIELD_REQUIRED',
        field,
        message: `Field '${field}' is required for type '${detectedType}'`,
      });
    }
  }

  const forbiddenPresent = (typeRules?.forbiddenFields ?? []).filter(field =>
    isFieldPresent(request, field),
  );
  for (const field of forbiddenPresent) {
    issues.push({
      code: 'FIELD_FORBIDDEN',
      field,
      message: `For type '${detectedType}', field '${field}' must not be provided`,
    });
  }

  validateMediaConstraints(request, detectedType, capabilities, issues, label);
  validateBodyAgainstCapabilities(request, capabilities, issues, label);
  validateTextFieldsAgainstCapabilities(request, capabilities, issues);
  validateAudienceAndStructure(request, capabilities, issues, label);
  validateExtraFields(request, detectedType, capabilities, issues);

  if (options.validateExtra) {
    const extraResult = options.validateExtra(request, detectedType);
    for (const item of extraResult) {
      if (typeof item === 'string') {
        issues.push({ code: 'VALIDATION_ERROR', message: item });
      } else {
        issues.push(item);
      }
    }
  }

  // Declared ignored fields
  const declaredIgnored = (capabilities.ignoredFields ?? []).filter(field =>
    isFieldPresent(request, field),
  );
  if (declaredIgnored.length > 0) {
    for (const field of declaredIgnored) {
      if (!ignoredFields.includes(field)) {
        ignoredFields.push(field);
      }
    }
    warnings.push({
      code: 'FIELDS_IGNORED',
      message: `Fields ${declaredIgnored.join(', ')} are not used by ${label} and will be ignored`,
      params: { fields: declaredIgnored },
    });
  }

  return {
    detectedType,
    issues,
    warnings,
    ignoredFields,
    errors: issues.map(i => i.message),
  };
}

function validateMediaConstraints(
  request: PostRequest,
  type: PostType,
  capabilities: PlatformCapabilities,
  issues: Issue[],
  label: string,
): void {
  const typeRules = capabilities.postTypes[type];
  const mediaList = request.media;

  if (Array.isArray(mediaList)) {
    const count = mediaList.length;
    if (typeRules?.minMediaCount !== undefined && count < typeRules.minMediaCount) {
      issues.push({
        code: 'MIN_MEDIA_COUNT',
        field: 'media',
        message: `Type '${type}' needs at least ${typeRules.minMediaCount} media item(s), got ${count}`,
        params: { min: typeRules.minMediaCount, actual: count },
      });
    }
    if (typeRules?.maxMediaCount !== undefined && count > typeRules.maxMediaCount) {
      issues.push({
        code: 'MAX_MEDIA_COUNT',
        field: 'media',
        message: `Type '${type}' accepts at most ${typeRules.maxMediaCount} media item(s), got ${count}`,
        params: { max: typeRules.maxMediaCount, actual: count },
      });
    }

    // Media counts per kind & mixing
    const kindCounts: Record<MediaType, number> = {
      image: 0,
      video: 0,
      audio: 0,
      document: 0,
    };
    for (const item of mediaList) {
      const kind = detectItemMediaKind(item, type);
      kindCounts[kind] += 1;
    }

    if (typeRules?.allowsMixedMedia === false) {
      const distinctKinds = Object.entries(kindCounts).filter(([_, c]) => c > 0);
      if (distinctKinds.length > 1) {
        issues.push({
          code: 'MIXED_MEDIA_NOT_ALLOWED',
          field: 'media',
          message: `For type '${type}', mixing different media kinds in 'media' is not allowed on ${label}`,
        });
      }
    }

    if (typeRules?.mediaCounts) {
      for (const [kindStr, bounds] of Object.entries(typeRules.mediaCounts)) {
        const kind = kindStr as MediaType;
        const actualCount = kindCounts[kind];
        if (bounds.min !== undefined && actualCount < bounds.min) {
          issues.push({
            code: 'MIN_MEDIA_KIND_COUNT',
            field: 'media',
            message: `Type '${type}' needs at least ${bounds.min} ${kind}(s), got ${actualCount}`,
          });
        }
        if (bounds.max !== undefined && actualCount > bounds.max) {
          issues.push({
            code: 'MAX_MEDIA_KIND_COUNT',
            field: 'media',
            message: `Type '${type}' accepts at most ${bounds.max} ${kind}(s), got ${actualCount}`,
          });
        }
      }
    }

    mediaList.forEach((media, index) => {
      const kind = detectItemMediaKind(media, type);
      validateOneMediaItem(media, kind, `media[${index}]`, capabilities, issues, label);
    });
  }

  if (request.thumbnail) {
    if (capabilities.thumbnail && !capabilities.thumbnail.supported) {
      issues.push({
        code: 'THUMBNAIL_UNSUPPORTED',
        field: 'thumbnail',
        message: `${label} does not support thumbnails`,
      });
    } else {
      validateOneMediaItem(request.thumbnail, 'image', 'thumbnail', capabilities, issues, label);
    }
  }
}

function validateOneMediaItem(
  media: MediaInput,
  kind: MediaType,
  field: string,
  capabilities: PlatformCapabilities,
  issues: Issue[],
  label: string,
): void {
  const constraints = capabilities.media?.[kind];

  if (constraints) {
    if (!constraints.acceptedSources.includes(media.source.kind)) {
      issues.push({
        code: 'UNSUPPORTED_MEDIA_SOURCE',
        field: `${field}.source`,
        message: `Media kind '${kind}' does not accept source kind '${media.source.kind}' on ${label}; accepted: ${constraints.acceptedSources.join(', ')}`,
      });
    }

    if (
      media.mimeType &&
      constraints.mimeTypes &&
      constraints.mimeTypes.length > 0 &&
      !constraints.mimeTypes.includes(media.mimeType)
    ) {
      issues.push({
        code: 'UNSUPPORTED_MIME_TYPE',
        field: `${field}.mimeType`,
        message: `MIME type '${media.mimeType}' is not supported for ${kind} on ${label}`,
      });
    }

    if (media.durationSecs !== undefined) {
      if (
        constraints.minDurationSecs !== undefined &&
        media.durationSecs < constraints.minDurationSecs
      ) {
        issues.push({
          code: 'DURATION_TOO_SHORT',
          field: `${field}.durationSecs`,
          message: `${kind} duration ${media.durationSecs}s is below the ${constraints.minDurationSecs}s minimum`,
        });
      }
      if (
        constraints.maxDurationSecs !== undefined &&
        media.durationSecs > constraints.maxDurationSecs
      ) {
        issues.push({
          code: 'DURATION_TOO_LONG',
          field: `${field}.durationSecs`,
          message: `${kind} duration ${media.durationSecs}s exceeds the ${constraints.maxDurationSecs}s maximum`,
        });
      }
    }

    if (media.width !== undefined && media.height !== undefined && media.height > 0) {
      const ratio = media.width / media.height;
      if (constraints.minAspectRatio !== undefined && ratio < constraints.minAspectRatio) {
        issues.push({
          code: 'ASPECT_RATIO_TOO_SMALL',
          field: `${field}.aspectRatio`,
          message: `${kind} aspect ratio ${ratio} is below the ${constraints.minAspectRatio} minimum`,
        });
      }
      if (constraints.maxAspectRatio !== undefined && ratio > constraints.maxAspectRatio) {
        issues.push({
          code: 'ASPECT_RATIO_TOO_LARGE',
          field: `${field}.aspectRatio`,
          message: `${kind} aspect ratio ${ratio} exceeds the ${constraints.maxAspectRatio} maximum`,
        });
      }
      if (constraints.minWidth !== undefined && media.width < constraints.minWidth) {
        issues.push({
          code: 'WIDTH_TOO_SMALL',
          field: `${field}.width`,
          message: `${kind} width ${media.width}px is below the ${constraints.minWidth}px minimum`,
        });
      }
      if (constraints.maxWidth !== undefined && media.width > constraints.maxWidth) {
        issues.push({
          code: 'WIDTH_TOO_LARGE',
          field: `${field}.width`,
          message: `${kind} width ${media.width}px exceeds the ${constraints.maxWidth}px maximum`,
        });
      }
      if (constraints.minHeight !== undefined && media.height < constraints.minHeight) {
        issues.push({
          code: 'HEIGHT_TOO_SMALL',
          field: `${field}.height`,
          message: `${kind} height ${media.height}px is below the ${constraints.minHeight}px minimum`,
        });
      }
      if (constraints.maxHeight !== undefined && media.height > constraints.maxHeight) {
        issues.push({
          code: 'HEIGHT_TOO_LARGE',
          field: `${field}.height`,
          message: `${kind} height ${media.height}px exceeds the ${constraints.maxHeight}px maximum`,
        });
      }
    }
  }

  // AltText
  if (capabilities.altText) {
    if (capabilities.altText.required && (!media.altText || media.altText.trim().length === 0)) {
      issues.push({
        code: 'ALT_TEXT_REQUIRED',
        field: `${field}.altText`,
        message: `Accessibility description (altText) is required for ${field} on ${label}`,
      });
    }
    if (!capabilities.altText.supported && media.altText) {
      issues.push({
        code: 'ALT_TEXT_UNSUPPORTED',
        field: `${field}.altText`,
        message: `${label} does not support altText on media`,
      });
    }
    if (
      capabilities.altText.maxLength !== undefined &&
      media.altText &&
      media.altText.length > capabilities.altText.maxLength
    ) {
      issues.push({
        code: 'ALT_TEXT_TOO_LONG',
        field: `${field}.altText`,
        message: `altText on ${field} must not exceed ${capabilities.altText.maxLength} characters`,
      });
    }
  }
}

function validateBodyAgainstCapabilities(
  request: PostRequest,
  capabilities: PlatformCapabilities,
  issues: Issue[],
  label: string,
): void {
  if (request.body && capabilities.maxBodyLength !== undefined) {
    const length = countBodyLength(request.body, capabilities.bodyLengthRule);
    if (length > capabilities.maxBodyLength) {
      issues.push({
        code: 'BODY_TOO_LONG',
        field: 'body',
        message: `Body length ${length} exceeds the ${capabilities.maxBodyLength} characters ${label} accepts`,
        params: { maxLength: capabilities.maxBodyLength, actualLength: length },
      });
    }
  }

  if (request.bodyFormat && capabilities.supportedBodyFormats) {
    if (!capabilities.supportedBodyFormats.includes(request.bodyFormat)) {
      issues.push({
        code: 'UNSUPPORTED_BODY_FORMAT',
        field: 'bodyFormat',
        message: `Body format '${request.bodyFormat}' is not supported for ${label}; supported: ${capabilities.supportedBodyFormats.join(', ')}`,
      });
    }
  }
}

function validateTextFieldsAgainstCapabilities(
  request: PostRequest,
  capabilities: PlatformCapabilities,
  issues: Issue[],
): void {
  if (
    request.title &&
    capabilities.maxTitleLength !== undefined &&
    request.title.length > capabilities.maxTitleLength
  ) {
    issues.push({
      code: 'TITLE_TOO_LONG',
      field: 'title',
      message: `Title length ${request.title.length} exceeds the maximum ${capabilities.maxTitleLength} characters`,
    });
  }

  if (
    request.description &&
    capabilities.maxDescriptionLength !== undefined &&
    request.description.length > capabilities.maxDescriptionLength
  ) {
    issues.push({
      code: 'DESCRIPTION_TOO_LONG',
      field: 'description',
      message: `Description length ${request.description.length} exceeds the maximum ${capabilities.maxDescriptionLength} characters`,
    });
  }

  if (
    request.tags &&
    capabilities.maxTags !== undefined &&
    request.tags.length > capabilities.maxTags
  ) {
    issues.push({
      code: 'TOO_MANY_TAGS',
      field: 'tags',
      message: `Tag count ${request.tags.length} exceeds the maximum ${capabilities.maxTags}`,
    });
  }

  if (request.tags && capabilities.maxTagLength !== undefined) {
    for (let i = 0; i < request.tags.length; i++) {
      const tag = request.tags[i];
      if (tag && tag.length > capabilities.maxTagLength) {
        issues.push({
          code: 'TAG_TOO_LONG',
          field: `tags[${i}]`,
          message: `Tag '${tag}' exceeds the maximum length of ${capabilities.maxTagLength} characters`,
        });
      }
    }
  }
}

function validateAudienceAndStructure(
  request: PostRequest,
  capabilities: PlatformCapabilities,
  issues: Issue[],
  label: string,
): void {
  if (request.visibility && capabilities.supportedVisibility) {
    if (!capabilities.supportedVisibility.includes(request.visibility)) {
      issues.push({
        code: 'UNSUPPORTED_VISIBILITY',
        field: 'visibility',
        message: `Visibility '${request.visibility}' is not supported for ${label}; supported: ${capabilities.supportedVisibility.join(', ')}`,
      });
    }
  }

  if (request.contentWarning && capabilities.supportsContentWarning === false) {
    issues.push({
      code: 'CONTENT_WARNING_UNSUPPORTED',
      field: 'contentWarning',
      message: `${label} does not support contentWarning`,
    });
  }

  if (request.sensitive !== undefined && capabilities.sensitive) {
    if (!capabilities.sensitive.supportedValues.includes(request.sensitive)) {
      issues.push({
        code: 'SENSITIVE_UNSUPPORTED',
        field: 'sensitive',
        message: `Setting sensitive=${request.sensitive} is not supported on ${label}`,
      });
    }
  }

  if (request.commentsEnabled !== undefined && capabilities.commentsEnabled) {
    if (!capabilities.commentsEnabled.supportedValues.includes(request.commentsEnabled)) {
      issues.push({
        code: 'COMMENTS_ENABLED_UNSUPPORTED',
        field: 'commentsEnabled',
        message: `Setting commentsEnabled=${request.commentsEnabled} is not supported on ${label}`,
      });
    }
  }

  if (request.inReplyTo && capabilities.supportsReply === false) {
    issues.push({
      code: 'REPLY_UNSUPPORTED',
      field: 'inReplyTo',
      message: `${label} does not support inReplyTo`,
    });
  }

  if (request.repostOf) {
    if (capabilities.supportsRepost === false) {
      issues.push({
        code: 'REPOST_UNSUPPORTED',
        field: 'repostOf',
        message: `${label} does not support repostOf`,
      });
    } else if (request.body && capabilities.supportsQuote === false) {
      issues.push({
        code: 'QUOTE_UNSUPPORTED',
        field: 'repostOf',
        message: `${label} does not support quoting posts`,
      });
    }
  }

  if (request.poll) {
    if (!capabilities.poll) {
      issues.push({
        code: 'POLL_UNSUPPORTED',
        field: 'poll',
        message: `${label} does not support polls`,
      });
    } else {
      const pollCaps = capabilities.poll;
      const optCount = request.poll.options.length;
      if (pollCaps.minOptions !== undefined && optCount < pollCaps.minOptions) {
        issues.push({
          code: 'POLL_MIN_OPTIONS',
          field: 'poll.options',
          message: `Poll requires at least ${pollCaps.minOptions} options on ${label}, got ${optCount}`,
        });
      }
      if (pollCaps.maxOptions !== undefined && optCount > pollCaps.maxOptions) {
        issues.push({
          code: 'POLL_MAX_OPTIONS',
          field: 'poll.options',
          message: `Poll accepts at most ${pollCaps.maxOptions} options on ${label}, got ${optCount}`,
        });
      }
      const maxOpt = pollCaps.maxOptionLength;
      if (maxOpt !== undefined) {
        request.poll.options.forEach((opt, idx) => {
          if (opt.length > maxOpt) {
            issues.push({
              code: 'POLL_OPTION_TOO_LONG',
              field: `poll.options[${idx}]`,
              message: `Poll option length (${opt.length}) exceeds maximum (${maxOpt})`,
            });
          }
        });
      }
      if (request.poll.durationSecs !== undefined) {
        if (
          pollCaps.minDurationSecs !== undefined &&
          request.poll.durationSecs < pollCaps.minDurationSecs
        ) {
          issues.push({
            code: 'POLL_DURATION_TOO_SHORT',
            field: 'poll.durationSecs',
            message: `Poll duration (${request.poll.durationSecs}s) is below minimum (${pollCaps.minDurationSecs}s)`,
          });
        }
        if (
          pollCaps.maxDurationSecs !== undefined &&
          request.poll.durationSecs > pollCaps.maxDurationSecs
        ) {
          issues.push({
            code: 'POLL_DURATION_TOO_LONG',
            field: 'poll.durationSecs',
            message: `Poll duration (${request.poll.durationSecs}s) exceeds maximum (${pollCaps.maxDurationSecs}s)`,
          });
        }
      }
      if (request.poll.multiple !== undefined && pollCaps.multiple) {
        if (!pollCaps.multiple.supportedValues.includes(request.poll.multiple)) {
          issues.push({
            code: 'POLL_MULTIPLE_UNSUPPORTED',
            field: 'poll.multiple',
            message: `Poll multiple=${request.poll.multiple} is not supported on ${label}`,
          });
        }
      }
      if (request.poll.anonymous !== undefined && pollCaps.anonymous) {
        if (!pollCaps.anonymous.supportedValues.includes(request.poll.anonymous)) {
          issues.push({
            code: 'POLL_ANONYMOUS_UNSUPPORTED',
            field: 'poll.anonymous',
            message: `Poll anonymous=${request.poll.anonymous} is not supported on ${label}`,
          });
        }
      }
    }
  }

  if (request.location) {
    if (!capabilities.location) {
      issues.push({
        code: 'LOCATION_UNSUPPORTED',
        field: 'location',
        message: `${label} does not support location`,
      });
    } else {
      const locCaps = capabilities.location;
      if (request.location.placeId && !locCaps.supportsPlaceId) {
        issues.push({
          code: 'LOCATION_PLACE_ID_UNSUPPORTED',
          field: 'location.placeId',
          message: `${label} does not support location placeId`,
        });
      }
      if (request.location.latitude !== undefined && !locCaps.supportsCoordinates) {
        issues.push({
          code: 'LOCATION_COORDINATES_UNSUPPORTED',
          field: 'location.coordinates',
          message: `${label} does not support location coordinates`,
        });
      }
      if (locCaps.requiresName && !request.location.name) {
        issues.push({
          code: 'LOCATION_NAME_REQUIRED',
          field: 'location.name',
          message: `Location name is required on ${label}`,
        });
      }
    }
  }

  if (request.scheduledAt && !capabilities.supportsNativeScheduling) {
    issues.push({
      code: 'NATIVE_SCHEDULING_UNSUPPORTED',
      field: 'scheduledAt',
      message: `${label} cannot schedule posts, so 'scheduledAt' would be ignored. Schedule the call itself instead of passing this field.`,
    });
  }

  if (request.mode === 'draft' && !capabilities.supportsDraft) {
    issues.push({
      code: 'DRAFT_UNSUPPORTED',
      field: 'mode',
      message: `${label} has no drafts, so mode 'draft' cannot be honoured`,
    });
  }

  if (request.idempotencyKey && !capabilities.supportsIdempotencyKey) {
    issues.push({
      code: 'IDEMPOTENCY_KEY_UNSUPPORTED',
      field: 'idempotencyKey',
      message: `${label} does not support idempotencyKey`,
    });
  }
}

function validateExtraFields(
  request: PostRequest,
  detectedType: PostType,
  capabilities: PlatformCapabilities,
  issues: Issue[],
): void {
  const extra = request.extra ?? {};
  const declaredSpecs = capabilities.extraFields ?? [];
  const specMap = new Map<string, ExtraFieldSpec>(declaredSpecs.map(s => [s.name, s]));

  // Check unknown extra fields
  if (!capabilities.allowUnknownExtraFields) {
    for (const key of Object.keys(extra)) {
      if (!specMap.has(key)) {
        issues.push({
          code: 'UNKNOWN_EXTRA_FIELD',
          field: `extra.${key}`,
          message: `Unknown extra field '${key}' is not declared for ${capabilities.name}`,
        });
      }
    }
  }

  // Validate declared fields
  for (const spec of declaredSpecs) {
    const applies = !spec.forTypes || spec.forTypes.includes(detectedType);
    const value = extra[spec.name];

    if (applies && spec.required && value === undefined) {
      issues.push({
        code: 'FIELD_REQUIRED',
        field: `extra.${spec.name}`,
        message: `Extra field '${spec.name}' is required for type '${detectedType}'`,
      });
      continue;
    }

    if (value !== undefined) {
      validateExtraFieldValue(spec, value, issues);
    }
  }
}

function validateExtraFieldValue(spec: ExtraFieldSpec, value: unknown, issues: Issue[]): void {
  const fieldName = `extra.${spec.name}`;

  switch (spec.type) {
    case 'string':
      if (typeof value !== 'string') {
        issues.push({
          code: 'INVALID_FIELD_TYPE',
          field: fieldName,
          message: `Extra field '${spec.name}' must be a string`,
        });
      } else {
        if (spec.maxLength !== undefined && value.length > spec.maxLength) {
          issues.push({
            code: 'FIELD_TOO_LONG',
            field: fieldName,
            message: `Extra field '${spec.name}' must not exceed ${spec.maxLength} characters`,
          });
        }
        if (spec.pattern && !new RegExp(spec.pattern).test(value)) {
          issues.push({
            code: 'INVALID_PATTERN',
            field: fieldName,
            message: `Extra field '${spec.name}' does not match pattern ${spec.pattern}`,
          });
        }
      }
      break;

    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        issues.push({
          code: 'INVALID_FIELD_TYPE',
          field: fieldName,
          message: `Extra field '${spec.name}' must be a finite number`,
        });
      } else {
        if (spec.min !== undefined && value < spec.min) {
          issues.push({
            code: 'VALUE_TOO_SMALL',
            field: fieldName,
            message: `Extra field '${spec.name}' must be at least ${spec.min}`,
          });
        }
        if (spec.max !== undefined && value > spec.max) {
          issues.push({
            code: 'VALUE_TOO_LARGE',
            field: fieldName,
            message: `Extra field '${spec.name}' must be at most ${spec.max}`,
          });
        }
      }
      break;

    case 'boolean':
      if (typeof value !== 'boolean') {
        issues.push({
          code: 'INVALID_FIELD_TYPE',
          field: fieldName,
          message: `Extra field '${spec.name}' must be a boolean`,
        });
      }
      break;

    case 'enum':
      if (!spec.values?.includes(value as string | number)) {
        issues.push({
          code: 'INVALID_ENUM_VALUE',
          field: fieldName,
          message: `Extra field '${spec.name}' must be one of: ${(spec.values ?? []).join(', ')}`,
        });
      }
      break;

    case 'string[]':
      if (!Array.isArray(value) || value.some(v => typeof v !== 'string')) {
        issues.push({
          code: 'INVALID_FIELD_TYPE',
          field: fieldName,
          message: `Extra field '${spec.name}' must be an array of strings`,
        });
      } else {
        if (spec.minItems !== undefined && value.length < spec.minItems) {
          issues.push({
            code: 'TOO_FEW_ITEMS',
            field: fieldName,
            message: `Extra field '${spec.name}' must contain at least ${spec.minItems} items`,
          });
        }
        if (spec.maxItems !== undefined && value.length > spec.maxItems) {
          issues.push({
            code: 'TOO_MANY_ITEMS',
            field: fieldName,
            message: `Extra field '${spec.name}' must contain at most ${spec.maxItems} items`,
          });
        }
      }
      break;

    case 'object':
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        issues.push({
          code: 'INVALID_FIELD_TYPE',
          field: fieldName,
          message: `Extra field '${spec.name}' must be an object`,
        });
      }
      break;
  }
}
