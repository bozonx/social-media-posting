import type { PostType } from '../types/post-type.js';

/** Constraints on one kind of media a platform accepts. */
export interface MediaConstraints {
  /** Accepted MIME types; an empty list means the platform states none. */
  mimeTypes?: string[];
  /** Largest accepted file size, in bytes. */
  maxBytes?: number;
  /** Smallest and largest accepted duration, in seconds (video and audio). */
  minDurationSecs?: number;
  maxDurationSecs?: number;
  /** Accepted aspect ratios as `width / height`, when the platform restricts them. */
  minAspectRatio?: number;
  maxAspectRatio?: number;
}

/** Rules for one post type on one platform. */
export interface PostTypeCapabilities {
  /** Fields a request of this type must carry. */
  requiredFields?: string[];
  /** Fields this type refuses outright, rather than ignoring. */
  forbiddenFields?: string[];
  /** Smallest and largest number of items in `media[]`. */
  minMediaCount?: number;
  maxMediaCount?: number;
}

/** How a platform counts the length of a body. */
export interface BodyLengthRule {
  /**
   * Characters a URL costs regardless of its real length, for platforms that
   * shorten links (X counts every URL as 23). Omit when URLs count literally.
   */
  urlWeight?: number;
  /** Whether the body counter includes the title, when the platform has one. */
  includesTitle?: boolean;
}

/**
 * Everything a platform can state about itself as data rather than code.
 *
 * This descriptor is what makes adding a network cheap: generic validation,
 * preview and body rendering all read it, so a new network contributes a data
 * structure instead of re-implementing the same ~150 lines of checks.
 */
export interface PlatformCapabilities {
  /** Platform name, matching {@link IPlatform.name}. */
  name: string;
  /** Human-readable name, used in messages shown to the caller. */
  displayName?: string;

  /** Post types this platform can publish. */
  supportedTypes: PostType[];
  /** Per-type rules, keyed by post type. */
  postTypes?: Partial<Record<PostType, PostTypeCapabilities>>;

  /** Largest body the platform accepts, in characters. */
  maxBodyLength?: number;
  /** How the platform counts that length. */
  bodyLengthRule?: BodyLengthRule;

  /** Body formats the platform accepts on input (e.g. 'text', 'html', 'md'). */
  supportedBodyFormats?: string[];
  /** The format bodies are converted to before being sent. */
  targetBodyFormat?: string;

  /** Constraints per media kind. */
  media?: {
    image?: MediaConstraints;
    video?: MediaConstraints;
    audio?: MediaConstraints;
    document?: MediaConstraints;
  };

  /** Whether the platform fetches media itself from a public URL. */
  supportsUrlPassthrough?: boolean;
  /** Whether publishing media requires uploading bytes to the platform. */
  requiresByteUpload?: boolean;

  /** Whether the platform can schedule a post itself. */
  supportsNativeScheduling?: boolean;
  /** Whether the platform can store a post as a draft. */
  supportsDraft?: boolean;
  /** Whether media can be hidden behind a spoiler. */
  supportsSpoiler?: boolean;
  /** Whether a cover image may accompany other media. */
  supportsCoverWithMedia?: boolean;
  /**
   * Request fields this platform accepts but does nothing with.
   *
   * Listing them is what turns a silently dropped field into a preview warning.
   * A field the platform actively refuses belongs in `postTypes.forbiddenFields`
   * instead, so the caller gets an error rather than a warning.
   */
  ignoredFields?: string[];

  /** Rate limits the platform documents, for the host to plan against. */
  rateLimits?: {
    /** Posts allowed per account per hour. */
    postsPerHour?: number;
    /** Posts allowed per account per day. */
    postsPerDay?: number;
    /** Free-text note about limits that do not fit the fields above. */
    note?: string;
  };
}
