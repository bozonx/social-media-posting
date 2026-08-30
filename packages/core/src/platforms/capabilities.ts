import type { PostType } from '../types/post-type.js';
import { isCanonicalPostType, isPlatformPostType } from '../types/post-type.js';
import type { MediaType, MediaSourceInput } from '../types/media-input.js';
import type { Visibility } from '../types/post-request.js';
import type { ArticleBlockType, InlineMark } from '../types/article-document.js';
import { ValidationError } from '../errors/posting-error.js';

export type RequestField =
  | 'body'
  | 'title'
  | 'description'
  | 'language'
  | 'tags'
  | 'media'
  | 'thumbnail'
  | 'visibility'
  | 'contentWarning'
  | 'sensitive'
  | 'commentsEnabled'
  | 'inReplyTo'
  | 'repostOf'
  | 'poll'
  | 'location'
  | 'scheduledAt'
  | 'mode';

export const REQUEST_FIELDS: readonly RequestField[] = [
  'body',
  'title',
  'description',
  'language',
  'tags',
  'media',
  'thumbnail',
  'visibility',
  'contentWarning',
  'sensitive',
  'commentsEnabled',
  'inReplyTo',
  'repostOf',
  'poll',
  'location',
  'scheduledAt',
  'mode',
] as const;

/** Constraints on one kind of media a platform accepts. */
export interface MediaConstraints {
  /** At least one source kind is required for each declared media type. */
  acceptedSources: MediaSourceInput['kind'][];
  /** Accepted MIME types; an empty list or omitted means the platform states none. */
  mimeTypes?: string[];
  /** Largest accepted file size, in bytes. */
  maxBytes?: number;
  /** Source-specific byte limits when the platform treats URLs and uploads differently. */
  maxBytesBySource?: Partial<Record<MediaSourceInput['kind'], number>>;
  /** Smallest and largest accepted duration, in seconds (video and audio). */
  minDurationSecs?: number;
  maxDurationSecs?: number;
  /** Accepted aspect ratios as `width / height`, when the platform restricts them. */
  minAspectRatio?: number;
  maxAspectRatio?: number;
  /** Min and max pixel dimensions. */
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;

  // — video traits —
  /** Frame rate bounds. Checked only when the `MediaInput` states its frame rate. */
  minFrameRate?: number;
  maxFrameRate?: number;
  /** Accepted container formats, lower-case: 'mp4', 'mov', 'webm'. */
  containers?: string[];
  /** Accepted video codecs, lower-case: 'h264', 'hevc', 'vp9'. */
  videoCodecs?: string[];
  /** Accepted audio codecs, lower-case. */
  audioCodecs?: string[];
  /** A cover image is mandatory (Pinterest, TikTok photo posts). */
  requiresCover?: boolean;

  // — transport —
  /**
   * Who moves the bytes.
   *
   * - `push`: the library uploads them, so a bare `url` cannot be published.
   * - `pull`: the network fetches the URL itself, so raw bytes cannot be sent.
   * - `both`: either works.
   *
   * Required: a descriptor that does not say this cannot be validated before
   * the first HTTP call, which is the whole point of the descriptor.
   */
  transport: 'push' | 'pull' | 'both';
  /** A pulled URL must be reachable by the network without credentials. */
  requiresPubliclyFetchableUrl?: boolean;
  /** How long a pulled URL must keep working after publication, in seconds. */
  urlMustRemainAvailableForSecs?: number;
}

/** Rules for one post type on one platform. */
export interface PostTypeCapabilities {
  /** Fields a request of this type must carry. */
  requiredFields?: RequestField[];
  /** Fields this type refuses outright, rather than ignoring. */
  forbiddenFields?: RequestField[];
  /** Smallest and largest number of items in `media[]`. */
  minMediaCount?: number;
  maxMediaCount?: number;
  /** Counts per media kind inside `media[]`. */
  mediaCounts?: Partial<Record<MediaType, { min?: number; max?: number }>>;
  /** Whether one `media[]` may mix kinds (Telegram cannot mix audio with photos). */
  allowsMixedMedia?: boolean;
  /** Type-specific body limit, overriding the platform-wide default. */
  maxBodyLength?: number;
  /** Type-specific title and description limits. */
  maxTitleLength?: number;
  maxDescriptionLength?: number;
  /** Type-specific tag limits. */
  maxTags?: number;
  maxTagLength?: number;
  /** Maximum serialized length of all tags, using commas as separators. */
  maxTagsLength?: number;
}

export interface CapabilitySource {
  /** Official documentation URL supporting one or more descriptor values. */
  url: string;
  /** Short description of the facts supported by this source. */
  supports: string[];
  /** Date on which the source was last checked, in YYYY-MM-DD form. */
  verifiedAt: string;
}

/** How a platform counts the length of a body. */
export interface BodyLengthRule {
  /**
   * What one unit of length is.
   *
   * Networks disagree, and the disagreement is not cosmetic: Bluesky's 300 is
   * 300 *graphemes*, so one emoji costs one there and two in `String.length`.
   * Counting in the wrong unit rejects posts a network would have taken, or
   * lets through posts it refuses.
   *
   * - `utf16` (default): `String.length`, what JavaScript counts.
   * - `graphemes`: user-perceived characters (Bluesky).
   * - `utf8Bytes`: encoded bytes (ATProto facet offsets, several APIs' limits).
   */
  countUnit?: 'utf16' | 'graphemes' | 'utf8Bytes';
  /**
   * Characters a URL costs regardless of its real length, for platforms that
   * shorten links (X counts every URL as 23). Omit when URLs count literally.
   */
  urlWeight?: number;
  /** Whether the body counter includes the title, when the platform has one. */
  includesTitle?: boolean;
}

export interface ToggleCapabilities {
  /** Values a caller may select; omitted means the field is unsupported. */
  supportedValues: boolean[];
  default?: boolean;
}

export interface ExtraFieldSpec {
  /** Key inside `request.extra`. */
  name: string;
  type: 'string' | 'number' | 'boolean' | 'enum' | 'string[]' | 'object';
  required?: boolean;

  /** Restrict the requirement to certain post types. */
  forTypes?: PostType[];
  values?: Array<string | number>;
  min?: number;
  max?: number;
  minItems?: number;
  maxItems?: number;
  pattern?: string;
  maxLength?: number;
  /** Human-readable label and hint, for a host that renders a form. */
  label?: string;
  description?: string;
}

export interface RateLimits {
  /** Posts allowed per account per hour. */
  postsPerHour?: number;
  /** Posts allowed per account per day. */
  postsPerDay?: number;
  /**
   * What one publication costs where the network bills in its own units
   * (YouTube spends 1600 `quotaUnits` per upload against a daily budget).
   */
  quotaCost?: { unit: string; perPublish?: number };
  /** What the quota actually counts. */
  quotaKind?: 'operations' | 'storage' | 'rollingWindow';
  /** Free-text note about limits that do not fit the fields above. */
  note?: string;
}

/** What a network reports about an account's remaining allowance. */
export interface QuotaState {
  /** Unit the numbers are in, matching `rateLimits.quotaCost.unit` when set. */
  unit: string;
  /** Allowance left, in `unit`. */
  remaining?: number;
  /** Total allowance for the period, in `unit`. */
  limit?: number;
  /** When the allowance resets (ISO 8601). */
  resetsAt?: string;
  /** When this reading was taken (ISO 8601). */
  fetchedAt: string;
  /** Raw payload, for logging. */
  raw?: unknown;
}

/**
 * Everything a platform can state about itself as data rather than code.
 *
 * This descriptor is what makes adding a network cheap: generic validation,
 * preview and body rendering all read it, so a new network contributes a data
 * structure instead of re-implementing checks.
 */
export interface PlatformCapabilities {
  /** Platform name, matching {@link IPlatform.name}. */
  name: string;
  /** Human-readable name, used in messages shown to the caller. */
  displayName?: string;
  /** Official sources used to maintain this descriptor. */
  sources?: CapabilitySource[];

  /** Per-type rules. Its keys are the definitive list of publishable types. */
  postTypes: Partial<Record<PostType, PostTypeCapabilities>>;

  // body
  maxBodyLength?: number;
  bodyLengthRule?: BodyLengthRule;
  supportedBodyFormats?: string[];
  targetBodyFormat?: string;
  passthroughBodyFormats?: string[];

  // text fields
  maxTitleLength?: number;
  maxDescriptionLength?: number;
  maxTags?: number;
  maxTagLength?: number;
  maxTagsLength?: number;
  tagFormat?: 'plain' | 'hashtag';

  /**
   * Parts of a composite `target` beyond `id`, validated exactly like `extra`.
   * Omitted when a single identifier addresses the destination.
   */
  targetSchema?: ExtraFieldSpec[];
  /** The account must carry an `apiBaseUrl` (per-instance networks). */
  requiresApiBaseUrl?: boolean;

  // media
  media?: Partial<Record<MediaType, MediaConstraints>>;
  altText?: { supported: boolean; required?: boolean; maxLength?: number };
  thumbnail?: { supported: boolean; maxBytes?: number };

  // audience and moderation
  supportedVisibility?: Visibility[];
  defaultVisibility?: Visibility;
  supportsContentWarning?: boolean;
  sensitive?: ToggleCapabilities;
  commentsEnabled?: ToggleCapabilities;

  /** What `PostType.ARTICLE` accepts. Absent means articles are unsupported. */
  article?: {
    blocks: ArticleBlockType[];
    marks: InlineMark[];
    maxTitleLength?: number;
    maxBlocks?: number;
  };

  /** Threads, when the network publishes a chain as one conversation. */
  thread?: {
    supported: boolean;
    maxSegments?: number;
    maxSegmentBodyLength?: number;
  };

  // structure
  supportsReply?: boolean;
  supportsRepost?: boolean;
  supportsQuote?: boolean;
  poll?: {
    minOptions?: number;
    maxOptions?: number;
    maxOptionLength?: number;
    minDurationSecs?: number;
    maxDurationSecs?: number;
    multiple?: ToggleCapabilities;
    anonymous?: ToggleCapabilities;
  };
  location?: {
    supportsCoordinates?: boolean;
    supportsPlaceId?: boolean;
    requiresName?: boolean;
  };

  // delivery
  supportsNativeScheduling?: boolean;
  minScheduleLeadSecs?: number;
  maxScheduleAheadSecs?: number;
  supportsDraft?: boolean;
  supportsIdempotencyKey?: boolean;
  supportsDeletion?: boolean;
  /** Whether `IPlatform.edit()` is implemented. Declared, not yet implemented anywhere. */
  supportsEdit?: boolean;

  // Hints for documentation/configuration, not a complete OAuth flow contract.
  auth?: {
    kind: 'apiKey' | 'oauth2' | 'custom';
    scopes?: string[];
    /** Whether a request must name a `target`. */
    requiresTarget?: boolean;
    docsUrl?: string;
  };

  /** Platform-specific fields the network requires or accepts, as data. */
  extraFields?: ExtraFieldSpec[];
  /** False by default: unknown `extra` keys are validation errors. */
  allowUnknownExtraFields?: boolean;

  /** Request fields this platform accepts but does nothing with. */
  ignoredFields?: RequestField[];

  /** Rate limits the platform documents, for the host to plan against. */
  rateLimits?: RateLimits;
}

/**
 * Validates a capability descriptor for consistency and integrity.
 * @throws ValidationError if the descriptor contains contradictory or invalid configuration.
 */
export function validateCapabilities(capabilities: PlatformCapabilities): void {
  const errors: string[] = [];
  const label = `Platform capability "${capabilities.name || 'unknown'}"`;

  if (typeof capabilities !== 'object' || (capabilities as unknown) === null) {
    throw new ValidationError('Capabilities must be an object');
  }

  if (typeof capabilities.name !== 'string' || capabilities.name.trim().length === 0) {
    errors.push(`${label}: name must be a non-empty string`);
  }

  if (typeof capabilities.postTypes !== 'object' || (capabilities.postTypes as unknown) === null) {
    errors.push(`${label}: postTypes must be an object`);
  } else {
    const types = Object.keys(capabilities.postTypes);
    if (types.length === 0) {
      errors.push(`${label}: postTypes must declare at least one publishable post type`);
    }
    for (const [type, rules] of Object.entries(capabilities.postTypes)) {
      if (type === 'auto') {
        errors.push(`${label}: postTypes must not include 'auto'`);
      } else if (!isCanonicalPostType(type) && !isPlatformPostType(type)) {
        errors.push(
          `${label}: post type '${type}' is neither a canonical type name nor a namespaced platform extension ('x-${capabilities.name}-<name>')`,
        );
      }
      if (rules) {
        if (
          rules.minMediaCount !== undefined &&
          rules.maxMediaCount !== undefined &&
          rules.minMediaCount > rules.maxMediaCount
        ) {
          errors.push(
            `${label}: for type '${type}', minMediaCount (${rules.minMediaCount}) cannot exceed maxMediaCount (${rules.maxMediaCount})`,
          );
        }
        const req = rules.requiredFields ?? [];
        const forb = rules.forbiddenFields ?? [];
        const overlap = req.filter(f => forb.includes(f));
        if (overlap.length > 0) {
          errors.push(
            `${label}: for type '${type}', fields cannot be both required and forbidden: ${overlap.join(', ')}`,
          );
        }
        for (const [mediaKind, counts] of Object.entries(rules.mediaCounts ?? {})) {
          if (counts.min !== undefined && counts.max !== undefined && counts.min > counts.max) {
            errors.push(
              `${label}: for type '${type}' media kind '${mediaKind}', min count (${counts.min}) cannot exceed max count (${counts.max})`,
            );
          }
        }
      }
    }
  }

  if (capabilities.media) {
    for (const [kind, constraints] of Object.entries(capabilities.media)) {
      if (!Array.isArray(constraints.acceptedSources) || constraints.acceptedSources.length === 0) {
        errors.push(
          `${label}: media constraints for '${kind}' must declare at least one acceptedSource`,
        );
      }

      if (!['push', 'pull', 'both'].includes(constraints.transport)) {
        errors.push(
          `${label}: media constraints for '${kind}' must declare transport as 'push', 'pull' or 'both'`,
        );
      }

      if (
        constraints.minFrameRate !== undefined &&
        constraints.maxFrameRate !== undefined &&
        constraints.minFrameRate > constraints.maxFrameRate
      ) {
        errors.push(
          `${label}: media constraints for '${kind}' minFrameRate cannot exceed maxFrameRate`,
        );
      }

      if (constraints.transport === 'pull' && !constraints.acceptedSources.includes('url')) {
        errors.push(
          `${label}: media constraints for '${kind}' declare transport 'pull' but do not accept a 'url' source`,
        );
      }

      if (
        constraints.minDurationSecs !== undefined &&
        constraints.maxDurationSecs !== undefined &&
        constraints.minDurationSecs > constraints.maxDurationSecs
      ) {
        errors.push(
          `${label}: media constraints for '${kind}' minDurationSecs cannot exceed maxDurationSecs`,
        );
      }
      if (
        constraints.minAspectRatio !== undefined &&
        constraints.maxAspectRatio !== undefined &&
        constraints.minAspectRatio > constraints.maxAspectRatio
      ) {
        errors.push(
          `${label}: media constraints for '${kind}' minAspectRatio cannot exceed maxAspectRatio`,
        );
      }
      if (
        constraints.minWidth !== undefined &&
        constraints.maxWidth !== undefined &&
        constraints.minWidth > constraints.maxWidth
      ) {
        errors.push(`${label}: media constraints for '${kind}' minWidth cannot exceed maxWidth`);
      }
      if (
        constraints.minHeight !== undefined &&
        constraints.maxHeight !== undefined &&
        constraints.minHeight > constraints.maxHeight
      ) {
        errors.push(`${label}: media constraints for '${kind}' minHeight cannot exceed maxHeight`);
      }
    }
  }

  if (
    capabilities.minScheduleLeadSecs !== undefined &&
    capabilities.maxScheduleAheadSecs !== undefined &&
    capabilities.minScheduleLeadSecs > capabilities.maxScheduleAheadSecs
  ) {
    errors.push(
      `${label}: minScheduleLeadSecs (${capabilities.minScheduleLeadSecs}) cannot exceed maxScheduleAheadSecs (${capabilities.maxScheduleAheadSecs})`,
    );
  }

  if (capabilities.poll) {
    const { minOptions, maxOptions, minDurationSecs, maxDurationSecs } = capabilities.poll;
    if (minOptions !== undefined && maxOptions !== undefined && minOptions > maxOptions) {
      errors.push(`${label}: poll minOptions cannot exceed maxOptions`);
    }
    if (
      minDurationSecs !== undefined &&
      maxDurationSecs !== undefined &&
      minDurationSecs > maxDurationSecs
    ) {
      errors.push(`${label}: poll minDurationSecs cannot exceed maxDurationSecs`);
    }
  }

  if (capabilities.defaultVisibility && capabilities.supportedVisibility) {
    if (!capabilities.supportedVisibility.includes(capabilities.defaultVisibility)) {
      errors.push(
        `${label}: defaultVisibility '${capabilities.defaultVisibility}' is not in supportedVisibility`,
      );
    }
  }

  if (capabilities.sensitive?.default !== undefined) {
    if (!capabilities.sensitive.supportedValues.includes(capabilities.sensitive.default)) {
      errors.push(`${label}: sensitive default is not in supportedValues`);
    }
  }

  if (capabilities.commentsEnabled?.default !== undefined) {
    if (
      !capabilities.commentsEnabled.supportedValues.includes(capabilities.commentsEnabled.default)
    ) {
      errors.push(`${label}: commentsEnabled default is not in supportedValues`);
    }
  }

  if (capabilities.article) {
    if (!capabilities.postTypes.article) {
      errors.push(`${label}: article rules are declared but 'article' is not a published type`);
    }
    if (!Array.isArray(capabilities.article.blocks) || capabilities.article.blocks.length === 0) {
      errors.push(`${label}: article.blocks must list at least one supported block`);
    }
  }

  if (capabilities.postTypes.article && !capabilities.article) {
    errors.push(
      `${label}: post type 'article' requires an 'article' section listing supported blocks and marks`,
    );
  }

  if (capabilities.thread?.supported && !capabilities.thread.maxSegments) {
    errors.push(`${label}: thread.supported requires maxSegments`);
  }

  for (const spec of capabilities.targetSchema ?? []) {
    if (spec.name === 'id') {
      errors.push(
        `${label}: targetSchema must not redeclare 'id'; it is part of every PlatformTarget`,
      );
    }
  }

  if (errors.length > 0) {
    throw new ValidationError(errors);
  }
}

/**
 * Fold runtime capabilities over the static descriptor.
 *
 * One implementation in the core rather than one per adapter, with rules stated
 * once: a runtime scalar overrides a static one, a runtime list replaces the
 * static list whole (a network that shrinks its accepted MIME types means
 * exactly those), and anything the runtime does not mention keeps its static
 * value.
 *
 * @param base - The descriptor the package ships.
 * @param runtime - What the network reported for this account.
 * @returns The merged descriptor. Neither input is mutated.
 */
export function mergeCapabilities(
  base: PlatformCapabilities,
  runtime: Partial<PlatformCapabilities>,
): PlatformCapabilities {
  return mergeValue(base, runtime) as PlatformCapabilities;
}

function mergeValue(base: unknown, runtime: unknown): unknown {
  if (runtime === undefined) {
    return base;
  }
  if (Array.isArray(runtime) || Array.isArray(base)) {
    return runtime;
  }
  if (isPlainRecord(base) && isPlainRecord(runtime)) {
    const merged: Record<string, unknown> = { ...base };
    for (const [key, value] of Object.entries(runtime)) {
      merged[key] = mergeValue(base[key], value);
    }
    return merged;
  }
  return runtime;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
