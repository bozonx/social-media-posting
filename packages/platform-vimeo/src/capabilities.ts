import { PostType } from '@bozonx/social-posting';
import type { PlatformCapabilities } from '@bozonx/social-posting';

const GIB_BYTES = 1024 * 1024 * 1024;
const MIB_BYTES = 1024 * 1024;

/** Longest video title Vimeo accepts. */
export const MAX_TITLE_LENGTH = 128;
/** Longest description Vimeo accepts. */
export const MAX_DESCRIPTION_LENGTH = 5_000;
/** Vimeo's own ceiling on the number of tags per video. */
export const MAX_TAGS = 20;
export const MAX_TAG_LENGTH = 30;

/**
 * Largest single file the upload endpoint accepts.
 *
 * A ceiling, not a promise: what an account may actually upload is bounded by
 * its plan's storage and its weekly allowance, both of which are smaller for
 * every plan below Premium. `getQuota()` reads the real numbers.
 */
export const MAX_VIDEO_BYTES = 256 * GIB_BYTES;

/** Chunk size for tus writes. */
export const CHUNK_SIZE_BYTES = 8 * MIB_BYTES;

/** Longest a host should wait for transcoding before calling an upload failed. */
export const MAX_PROCESSING_WAIT_SECS = 4 * 60 * 60;

const videoConstraints = {
  // Both approaches are real here, unlike on YouTube: `pull` hands Vimeo a URL
  // and it fetches the file itself, `tus` pushes the bytes. Which one runs is
  // chosen per request through `extra.uploadApproach`.
  acceptedSources: ['url', 'bytes', 'blob', 'stream'] as const,
  transport: 'both' as const,
  maxBytes: MAX_VIDEO_BYTES,
  containers: ['mp4', 'mov', 'wmv', 'avi', 'flv', 'webm', 'mpeg4'],
  requiresPubliclyFetchableUrl: true,
  // Vimeo fetches a pull URL asynchronously, after the create call returns.
  // A link that dies with the request is a publication that fails minutes
  // later with nothing in the response to explain it.
  urlMustRemainAvailableForSecs: 24 * 60 * 60,
};

/**
 * What Vimeo accepts, stated as data.
 *
 * Vimeo publishes videos and nothing else: no text posts, no images, no
 * galleries, no stories. A vertical video is an ordinary video — there is no
 * Shorts-equivalent product and therefore no `shortVideo` here, which is the
 * one place this descriptor differs from YouTube's for a product reason rather
 * than a protocol one.
 */
export const vimeoCapabilities: PlatformCapabilities = {
  name: 'vimeo',
  displayName: 'Vimeo',
  sources: [
    {
      url: 'https://developer.vimeo.com/api/upload/videos',
      supports: ['tus upload approach', 'pull approach', 'upload.size requirement'],
      verifiedAt: '2026-08-30',
    },
    {
      url: 'https://developer.vimeo.com/api/reference/videos',
      supports: ['video resource fields', 'transcode.status', 'privacy.view'],
      verifiedAt: '2026-08-30',
    },
    {
      url: 'https://developer.vimeo.com/api/reference/users',
      supports: ['upload_quota space and periodic allowance'],
      verifiedAt: '2026-08-30',
    },
    {
      url: 'https://tus.io/protocols/resumable-upload',
      supports: ['Tus-Resumable', 'Upload-Offset', 'PATCH semantics'],
      verifiedAt: '2026-08-30',
    },
  ],

  postTypes: {
    [PostType.VIDEO]: {
      requiredFields: ['media'],
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

  // `unlisted` is Vimeo's `privacy.view = "unlisted"`; `private` is `nobody`.
  // The password and domain-restricted modes are richer than this vocabulary
  // and are reached through `extra.privacyView`.
  supportedVisibility: ['public', 'unlisted', 'private'],
  defaultVisibility: 'unlisted',

  thumbnail: { supported: false },
  altText: { supported: false },
  supportsReply: false,
  supportsRepost: false,
  supportsQuote: false,

  auth: {
    kind: 'oauth2',
    scopes: ['upload', 'edit', 'private', 'video_files'],
    // The account is the token's own; Vimeo has no second destination to name.
    requiresTarget: false,
    docsUrl: 'https://developer.vimeo.com/api/authentication',
  },

  extraFields: [
    {
      name: 'uploadApproach',
      type: 'enum',
      values: ['tus', 'pull'],
      label: 'Upload approach',
      description:
        'How the bytes reach Vimeo. "tus" uploads them from this process and can be resumed; "pull" hands Vimeo a URL it fetches itself, which needs no upload bandwidth but no longer reports upload progress.',
    },
    {
      name: 'privacyView',
      type: 'enum',
      values: ['anybody', 'nobody', 'unlisted', 'contacts', 'password', 'disable'],
      label: 'Privacy mode',
      description: "Vimeo's own privacy vocabulary, for modes `visibility` cannot express.",
    },
    { name: 'password', type: 'string', description: 'Required when privacyView is "password".' },
    {
      name: 'folderUri',
      type: 'string',
      label: 'Folder',
      description: 'Project to file it under.',
    },
    { name: 'license', type: 'string' },
    { name: 'contentRating', type: 'string[]' },
  ],
  allowUnknownExtraFields: false,

  supportsNativeScheduling: false,
  // Vimeo's privacy modes are not a draft: the file is stored and the storage
  // is charged the moment the upload completes.
  supportsDraft: false,
  supportsIdempotencyKey: false,
  supportsDeletion: false,
  supportsEdit: false,

  asyncProcessing: {
    supported: true,
    typicalSecs: 3 * 60,
    maxWaitSecs: MAX_PROCESSING_WAIT_SECS,
    pollIntervalSecs: 20,
  },

  rateLimits: {
    // Bytes, not operations. The difference matters to the user: a spent
    // YouTube budget means "tomorrow", a full Vimeo account means "delete
    // something or upgrade", and only the unit distinguishes them.
    quotaCost: { unit: 'bytes' },
    quotaKind: 'storage',
    note: 'Vimeo limits total stored bytes and a weekly upload allowance, both set by the account plan rather than by the API. `getQuota()` reads the current numbers from /me.',
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
