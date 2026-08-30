import { PostType } from '@bozonx/social-posting';
import type { PlatformCapabilities } from '@bozonx/social-posting';

const GIB_BYTES = 1024 * 1024 * 1024;
const MIB_BYTES = 1024 * 1024;

/** Longest title YouTube accepts, in UTF-16 code units. */
export const MAX_TITLE_LENGTH = 100;
/** Longest description YouTube accepts. */
export const MAX_DESCRIPTION_LENGTH = 5_000;
/** Longest single tag, and the ceiling on all tags joined by commas. */
export const MAX_TAG_LENGTH = 100;
export const MAX_TAGS_LENGTH = 500;

/**
 * Largest file `videos.insert` accepts, for any account.
 *
 * A floor in practice as well as a ceiling: an unverified channel is capped at
 * 15 minutes of video regardless of file size, which is a property of the
 * channel rather than of the API and therefore is not stated here.
 */
export const MAX_VIDEO_BYTES = 256 * GIB_BYTES;

/** Longest video an account may upload once its channel is verified. */
export const MAX_VIDEO_DURATION_SECS = 12 * 60 * 60;

/** Largest custom thumbnail. */
export const MAX_THUMBNAIL_BYTES = 2 * MIB_BYTES;

/** What one `videos.insert` costs against the daily quota. */
export const UPLOAD_QUOTA_UNITS = 1_600;
/** The default daily budget a new Google Cloud project is granted. */
export const DEFAULT_DAILY_QUOTA_UNITS = 10_000;

/**
 * Longest a host should wait for transcoding before calling an upload failed.
 *
 * Deliberately generous: YouTube routinely takes longer than a quarter of an
 * hour on a long or high-resolution video, and a host that gives up at fifteen
 * minutes marks successful uploads as failures. The video exists either way —
 * the only thing lost is the host's record of it.
 */
export const MAX_PROCESSING_WAIT_SECS = 6 * 60 * 60;

/** Chunk size for the resumable protocol: Google requires a multiple of 256 KiB. */
export const CHUNK_SIZE_BYTES = 8 * MIB_BYTES;

/** Every category id is a channel-independent constant; 22 is "People & Blogs". */
export const DEFAULT_CATEGORY_ID = '22';

const videoConstraints = {
  // YouTube never fetches a URL: every byte goes up through the resumable
  // session. A `url` source is accepted because this adapter downloads it
  // first, which is what makes the transport `both` rather than `pull`.
  acceptedSources: ['url', 'bytes', 'blob', 'stream'] as const,
  transport: 'both' as const,
  maxBytes: MAX_VIDEO_BYTES,
  maxDurationSecs: MAX_VIDEO_DURATION_SECS,
  containers: ['mp4', 'mov', 'avi', 'wmv', 'flv', 'webm', 'mpeg4', '3gpp', 'mpegps'],
};

/**
 * What YouTube accepts, stated as data.
 *
 * Two absences are deliberate. There is no separate Shorts endpoint, so
 * `shortVideo` and `video` are the same `videos.insert` call and the same
 * limits — what makes a Short is YouTube's own classification of the finished
 * file, applied after upload, and no adapter can promise it. And there is no
 * `post`, `image` or `album`: a YouTube channel publishes videos, and the
 * community-post API is not public.
 */
export const youtubeCapabilities: PlatformCapabilities = {
  name: 'youtube',
  displayName: 'YouTube',
  sources: [
    {
      url: 'https://developers.google.com/youtube/v3/docs/videos/insert',
      supports: ['videos.insert', 'snippet and status fields', 'required parts'],
      verifiedAt: '2026-08-30',
    },
    {
      url: 'https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol',
      supports: ['resumable session initiation', 'Content-Range chunks', 'position query'],
      verifiedAt: '2026-08-30',
    },
    {
      url: 'https://developers.google.com/youtube/v3/docs/videos/list',
      supports: ['processingDetails', 'processing status polling'],
      verifiedAt: '2026-08-30',
    },
    {
      url: 'https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits',
      supports: ['quota units', 'videos.insert cost'],
      verifiedAt: '2026-08-30',
    },
    {
      url: 'https://developers.google.com/youtube/v3/docs/thumbnails/set',
      supports: ['custom thumbnail upload', 'thumbnail size limit'],
      verifiedAt: '2026-08-30',
    },
  ],

  postTypes: {
    [PostType.VIDEO]: {
      requiredFields: ['media', 'title'],
      forbiddenFields: ['poll', 'location'],
      minMediaCount: 1,
      maxMediaCount: 1,
      mediaCounts: { video: { min: 1, max: 1 } },
      maxTitleLength: MAX_TITLE_LENGTH,
      maxDescriptionLength: MAX_DESCRIPTION_LENGTH,
      maxTagLength: MAX_TAG_LENGTH,
      maxTagsLength: MAX_TAGS_LENGTH,
    },
    [PostType.SHORT_VIDEO]: {
      requiredFields: ['media', 'title'],
      forbiddenFields: ['poll', 'location'],
      minMediaCount: 1,
      maxMediaCount: 1,
      mediaCounts: { video: { min: 1, max: 1 } },
      maxTitleLength: MAX_TITLE_LENGTH,
      maxDescriptionLength: MAX_DESCRIPTION_LENGTH,
      maxTagLength: MAX_TAG_LENGTH,
      maxTagsLength: MAX_TAGS_LENGTH,
    },
  },

  // The description is the body. YouTube has no separate post text.
  maxBodyLength: MAX_DESCRIPTION_LENGTH,
  bodyLengthRule: {},
  supportedBodyFormats: ['text'],
  targetBodyFormat: 'text',

  maxTitleLength: MAX_TITLE_LENGTH,
  maxDescriptionLength: MAX_DESCRIPTION_LENGTH,
  maxTagLength: MAX_TAG_LENGTH,
  maxTagsLength: MAX_TAGS_LENGTH,
  tagFormat: 'plain',

  media: { video: { ...videoConstraints, acceptedSources: [...videoConstraints.acceptedSources] } },

  // A thumbnail is a separate authenticated call after the insert, not a field
  // of the video resource, and it needs the wider `youtube` scope.
  thumbnail: { supported: true, maxBytes: MAX_THUMBNAIL_BYTES },

  // `private` is not a draft: the video exists, it cost its quota, and it can
  // be made public without re-uploading. See `supportsDraft` below.
  supportedVisibility: ['public', 'unlisted', 'private'],
  defaultVisibility: 'private',

  altText: { supported: false },
  supportsReply: false,
  supportsRepost: false,
  supportsQuote: false,

  // The channel is whichever one the token was issued for. A `target` would be
  // a second source of truth for something the credential already decides.
  auth: {
    kind: 'oauth2',
    scopes: [
      'https://www.googleapis.com/auth/youtube.upload',
      'https://www.googleapis.com/auth/youtube',
    ],
    requiresTarget: false,
    docsUrl: 'https://developers.google.com/youtube/v3/guides/authentication',
  },

  extraFields: [
    {
      name: 'categoryId',
      type: 'string',
      pattern: '^[0-9]{1,3}$',
      label: 'Category id',
      description: `YouTube video category. Defaults to ${DEFAULT_CATEGORY_ID} unless the account sets one.`,
    },
    {
      name: 'madeForKids',
      type: 'boolean',
      label: 'Made for kids',
      description: 'Self-declared audience. Required by law in some jurisdictions.',
    },
    {
      name: 'embeddable',
      type: 'boolean',
    },
    {
      name: 'license',
      type: 'enum',
      values: ['youtube', 'creativeCommon'],
    },
    {
      name: 'publicStatsViewable',
      type: 'boolean',
    },
    {
      name: 'notifySubscribers',
      type: 'boolean',
      label: 'Notify subscribers',
      description: 'Whether subscribers are told about the upload.',
    },
    {
      name: 'recordingDate',
      type: 'string',
      label: 'Recording date',
      description: 'ISO 8601 date the video was recorded.',
    },
  ],
  allowUnknownExtraFields: false,

  // `scheduledAt` maps to `status.publishAt`, which YouTube honours only for a
  // video whose privacy status is `private`.
  supportsNativeScheduling: true,
  minScheduleLeadSecs: 60,

  // There is no draft state. A `private` video is published, quota is spent and
  // the file is stored; declaring a draft here would promise something free
  // that is not.
  supportsDraft: false,
  supportsIdempotencyKey: false,

  // Deletion works, but this iteration does not implement it: `delete()` is
  // absent from the adapter, and saying otherwise here would be a lie the
  // conformance suite would catch.
  supportsDeletion: false,
  supportsEdit: false,

  asyncProcessing: {
    supported: true,
    typicalSecs: 5 * 60,
    maxWaitSecs: MAX_PROCESSING_WAIT_SECS,
    pollIntervalSecs: 30,
  },

  rateLimits: {
    // Units, not posts: the number a host must plan against is the daily
    // budget divided by 1600, and the message on exhaustion is "tomorrow",
    // not "free up space".
    quotaCost: { unit: 'quotaUnits', perPublish: UPLOAD_QUOTA_UNITS },
    quotaKind: 'operations',
    note: `videos.insert costs ${UPLOAD_QUOTA_UNITS} quota units against a project's daily budget (${DEFAULT_DAILY_QUOTA_UNITS} by default), so roughly six uploads a day before an increase is needed. The budget belongs to the Google Cloud project, not to the channel: every channel a host serves spends the same pool.`,
  },

  ignoredFields: [
    'contentWarning',
    'sensitive',
    'commentsEnabled',
    'inReplyTo',
    'repostOf',
    'location',
    'poll',
    'mode',
  ],
};
