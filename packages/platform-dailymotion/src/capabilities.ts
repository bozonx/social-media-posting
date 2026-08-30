import { PostType } from '@bozonx/social-posting';
import type { PlatformCapabilities } from '@bozonx/social-posting';

const GIB_BYTES = 1024 * 1024 * 1024;

/** Longest title Dailymotion accepts. */
export const MAX_TITLE_LENGTH = 255;
/** Longest description Dailymotion accepts. */
export const MAX_DESCRIPTION_LENGTH = 3_000;
/** Tag limits. */
export const MAX_TAGS = 20;
export const MAX_TAG_LENGTH = 40;

/** Largest file the upload endpoint accepts. */
export const MAX_VIDEO_BYTES = 2 * GIB_BYTES;
/** Longest video an ordinary account may publish. */
export const MAX_VIDEO_DURATION_SECS = 60 * 60;

/** Longest a host should wait for encoding before calling an upload failed. */
export const MAX_PROCESSING_WAIT_SECS = 2 * 60 * 60;

const videoConstraints = {
  // The file is POSTed to a signed upload host in one request; a `url` source
  // is downloaded here first. Dailymotion never fetches a link itself.
  acceptedSources: ['url', 'bytes', 'blob', 'stream'] as const,
  transport: 'both' as const,
  maxBytes: MAX_VIDEO_BYTES,
  maxDurationSecs: MAX_VIDEO_DURATION_SECS,
  containers: ['mp4', 'mov', 'avi', 'wmv', 'flv', 'webm', 'mkv', 'mpeg4'],
};

/**
 * What Dailymotion accepts, stated as data.
 *
 * The narrowest descriptor in the set, and honestly so: Dailymotion publishes
 * videos and nothing else — no text, no images, no galleries, no stories. Nor
 * is there a Shorts equivalent, so a vertical video is an ordinary upload and
 * `shortVideo` is absent rather than aliased to `video`.
 */
export const dailymotionCapabilities: PlatformCapabilities = {
  name: 'dailymotion',
  displayName: 'Dailymotion',
  sources: [
    {
      url: 'https://developers.dailymotion.com/guides/upload-videos/',
      supports: ['three-step upload', 'file/upload ticket', 'videos.create from url'],
      verifiedAt: '2026-08-30',
    },
    {
      url: 'https://developers.dailymotion.com/api/',
      supports: ['video fields', 'status and encoding_progress', 'OAuth token endpoint'],
      verifiedAt: '2026-08-30',
    },
  ],

  postTypes: {
    [PostType.VIDEO]: {
      // Dailymotion refuses an untitled video outright, so `title` is required
      // here rather than merely recommended.
      requiredFields: ['media', 'title'],
      forbiddenFields: ['poll'],
      minMediaCount: 1,
      maxMediaCount: 1,
      mediaCounts: { video: { min: 1, max: 1 } },
      maxTitleLength: MAX_TITLE_LENGTH,
      maxDescriptionLength: MAX_DESCRIPTION_LENGTH,
      maxTags: MAX_TAGS,
      maxTagLength: MAX_TAG_LENGTH,
    },
  },

  maxBodyLength: MAX_DESCRIPTION_LENGTH,
  bodyLengthRule: {},
  supportedBodyFormats: ['text'],
  targetBodyFormat: 'text',

  maxTitleLength: MAX_TITLE_LENGTH,
  maxDescriptionLength: MAX_DESCRIPTION_LENGTH,
  maxTags: MAX_TAGS,
  maxTagLength: MAX_TAG_LENGTH,
  tagFormat: 'plain',

  media: { video: { ...videoConstraints, acceptedSources: [...videoConstraints.acceptedSources] } },

  // `published=false` leaves the video private to its owner. Not a draft: the
  // file is uploaded and encoded either way.
  supportedVisibility: ['public', 'private'],
  defaultVisibility: 'private',

  thumbnail: { supported: false },
  altText: { supported: false },
  supportsReply: false,
  supportsRepost: false,
  supportsQuote: false,

  auth: {
    kind: 'oauth2',
    scopes: ['manage_videos'],
    requiresTarget: false,
    docsUrl: 'https://developers.dailymotion.com/api/#authentication',
  },

  extraFields: [
    {
      name: 'channel',
      type: 'string',
      label: 'Channel',
      description: "Dailymotion's own content category, e.g. 'tech' or 'news'.",
    },
    { name: 'isCreatedForKids', type: 'boolean', label: 'Made for kids' },
    { name: 'isExplicit', type: 'boolean', label: 'Explicit content' },
    { name: 'geoblocking', type: 'string[]' },
    { name: 'playerNextVideos', type: 'string[]' },
  ],
  allowUnknownExtraFields: false,

  supportsNativeScheduling: false,
  supportsDraft: false,
  supportsIdempotencyKey: false,
  supportsDeletion: false,
  supportsEdit: false,

  asyncProcessing: {
    supported: true,
    typicalSecs: 2 * 60,
    maxWaitSecs: MAX_PROCESSING_WAIT_SECS,
    pollIntervalSecs: 15,
  },

  rateLimits: {
    quotaKind: 'rollingWindow',
    note: 'Dailymotion caps the number of uploads per day and the total duration published, both by account status (ordinary, verified, partner) rather than by anything the API states. An exhausted cap arrives as a limit_reached_error.',
  },

  ignoredFields: [
    'contentWarning',
    'sensitive',
    'commentsEnabled',
    'inReplyTo',
    'repostOf',
    'location',
    'poll',
    'scheduledAt',
    'mode',
    'thumbnail',
  ],
};
