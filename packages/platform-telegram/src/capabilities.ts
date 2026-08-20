import { PostType } from '@bozonx/social-posting';
import type { PlatformCapabilities } from '@bozonx/social-posting';

/** Largest number of items the Bot API accepts in one media group. */
export const MAX_MEDIA_GROUP_SIZE = 10;
/** Largest caption Telegram accepts on a media message. */
export const MAX_CAPTION_LENGTH = 1024;

/**
 * What Telegram accepts, stated as data.
 */
export const telegramCapabilities: PlatformCapabilities = {
  name: 'telegram',
  displayName: 'Telegram',

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
    },
    [PostType.VIDEO]: {
      requiredFields: ['media'],
      minMediaCount: 1,
      maxMediaCount: 1,
      mediaCounts: { video: { min: 1, max: 1 } },
    },
    [PostType.AUDIO]: {
      requiredFields: ['media'],
      minMediaCount: 1,
      maxMediaCount: 1,
      mediaCounts: { audio: { min: 1, max: 1 } },
    },
    [PostType.DOCUMENT]: {
      requiredFields: ['media'],
      minMediaCount: 1,
      maxMediaCount: 1,
      mediaCounts: { document: { min: 1, max: 1 } },
    },
    [PostType.ALBUM]: {
      requiredFields: ['media'],
      minMediaCount: 1,
      maxMediaCount: MAX_MEDIA_GROUP_SIZE,
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

  media: {
    image: {
      acceptedSources: ['url', 'bytes', 'blob', 'stream', 'platformRef'],
    },
    video: {
      acceptedSources: ['url', 'bytes', 'blob', 'stream', 'platformRef'],
    },
    audio: {
      acceptedSources: ['url', 'bytes', 'blob', 'stream', 'platformRef'],
    },
    document: {
      acceptedSources: ['url', 'bytes', 'blob', 'stream', 'platformRef'],
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

  extraFields: [
    { name: 'message_thread_id', type: 'number', min: 1 },
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

  allowUnknownExtraFields: true,

  rateLimits: {
    note: 'Bot API limits depend on chat type; hosts must honour retry_after from 429 responses.',
  },

  supportsNativeScheduling: false,
  supportsDraft: false,
  supportsIdempotencyKey: false,

  ignoredFields: ['title', 'description', 'language', 'tags'],
};
