import { PostType } from '@bozonx/social-posting';
import type { PlatformCapabilities } from '@bozonx/social-posting';

/** Largest number of items the Bot API accepts in one media group. */
export const MAX_MEDIA_GROUP_SIZE = 10;
/** Largest caption Telegram accepts on a media message. */
export const MAX_CAPTION_LENGTH = 1024;
const MB_BYTES = 1024 * 1024;
export const MAX_URL_PHOTO_BYTES = 5 * MB_BYTES;
export const MAX_URL_FILE_BYTES = 20 * MB_BYTES;

/**
 * What Telegram accepts, stated as data.
 */
export const telegramCapabilities: PlatformCapabilities = {
  name: 'telegram',
  displayName: 'Telegram',
  sources: [
    {
      url: 'https://core.telegram.org/bots/api',
      supports: ['body length', 'caption length', 'media groups', 'media upload limits'],
      verifiedAt: '2026-08-29',
    },
  ],

  postTypes: {
    [PostType.POST]: {
      requiredFields: ['body'],
      forbiddenFields: ['media', 'poll'],
    },
    [PostType.IMAGE]: {
      requiredFields: ['media'],
      minMediaCount: 1,
      maxMediaCount: 1,
      mediaCounts: { image: { min: 1, max: 1 } },
      maxBodyLength: MAX_CAPTION_LENGTH,
    },
    [PostType.VIDEO]: {
      requiredFields: ['media'],
      minMediaCount: 1,
      maxMediaCount: 1,
      mediaCounts: { video: { min: 1, max: 1 } },
      maxBodyLength: MAX_CAPTION_LENGTH,
    },
    [PostType.AUDIO]: {
      requiredFields: ['media'],
      minMediaCount: 1,
      maxMediaCount: 1,
      mediaCounts: { audio: { min: 1, max: 1 } },
      maxBodyLength: MAX_CAPTION_LENGTH,
    },
    [PostType.DOCUMENT]: {
      requiredFields: ['media'],
      minMediaCount: 1,
      maxMediaCount: 1,
      mediaCounts: { document: { min: 1, max: 1 } },
      maxBodyLength: MAX_CAPTION_LENGTH,
    },
    [PostType.ALBUM]: {
      requiredFields: ['media'],
      minMediaCount: 2,
      maxMediaCount: MAX_MEDIA_GROUP_SIZE,
      maxBodyLength: MAX_CAPTION_LENGTH,
    },
    [PostType.POLL]: {
      requiredFields: ['poll'],
      forbiddenFields: ['media'],
    },
  },

  maxBodyLength: 4096,
  bodyLengthRule: {},

  supportedBodyFormats: ['text', 'html', 'md', 'MarkdownV2'],
  targetBodyFormat: 'html',
  passthroughBodyFormats: ['MarkdownV2'],

  // Telegram fetches the URL itself (or re-uses a file_id it already holds);
  // this adapter never uploads bytes, so the transport is 'pull' throughout.
  media: {
    image: {
      acceptedSources: ['url', 'platformRef'],
      transport: 'pull',
      requiresPubliclyFetchableUrl: true,
      maxBytesBySource: { url: MAX_URL_PHOTO_BYTES },
    },
    video: {
      acceptedSources: ['url', 'platformRef'],
      transport: 'pull',
      requiresPubliclyFetchableUrl: true,
      maxBytesBySource: { url: MAX_URL_FILE_BYTES },
    },
    audio: {
      acceptedSources: ['url', 'platformRef'],
      transport: 'pull',
      requiresPubliclyFetchableUrl: true,
      maxBytesBySource: { url: MAX_URL_FILE_BYTES },
    },
    document: {
      acceptedSources: ['url', 'platformRef'],
      transport: 'pull',
      requiresPubliclyFetchableUrl: true,
      maxBytesBySource: { url: MAX_URL_FILE_BYTES },
    },
  },

  sensitive: {
    supportedValues: [false, true],
  },

  supportsReply: true,
  supportsRepost: true,
  supportsQuote: true,

  poll: {
    minOptions: 2,
    maxOptions: 10,
    maxOptionLength: 100,
    minDurationSecs: 5,
    maxDurationSecs: 600,
    multiple: { supportedValues: [false, true] },
    anonymous: { supportedValues: [false, true] },
  },

  location: {
    supportsCoordinates: true,
    supportsPlaceId: false,
    requiresName: false,
  },

  // A forum topic is part of the address, not an option: it lives in `target`.
  targetSchema: [
    {
      name: 'messageThreadId',
      type: 'number',
      min: 1,
      label: 'Forum topic id',
      description: 'Message thread of a forum-enabled supergroup.',
    },
  ],

  extraFields: [
    { name: 'protect_content', type: 'boolean' },
    { name: 'has_spoiler', type: 'boolean' },
    { name: 'is_anonymous', type: 'boolean' },
    { name: 'allows_multiple_answers', type: 'boolean' },
    { name: 'open_period', type: 'number' },
    { name: 'close_date', type: 'number' },
    { name: 'address', type: 'string' },
    { name: 'foursquare_id', type: 'string' },
    { name: 'foursquare_type', type: 'string' },
    { name: 'google_place_id', type: 'string' },
    { name: 'google_place_type', type: 'string' },
    { name: 'show_caption_above_media', type: 'boolean' },
    { name: 'effect_id', type: 'string' },
    { name: 'parse_mode', type: 'string' },
    { name: 'reply_markup', type: 'object' },
    { name: 'link_preview_options', type: 'object' },
    { name: 'reply_parameters', type: 'object' },
  ],

  allowUnknownExtraFields: false,

  rateLimits: {
    note: 'Bot API limits depend on chat type; hosts must honour retry_after from 429 responses.',
  },

  auth: {
    kind: 'apiKey',
    requiresTarget: true,
    docsUrl: 'https://core.telegram.org/bots/api#sendmessage',
  },

  supportsNativeScheduling: false,
  supportsDraft: false,
  supportsIdempotencyKey: false,
  supportsDeletion: true,

  ignoredFields: ['title', 'description', 'language', 'tags'],
};
