import { PostType } from '@bozonx/social-posting';
import type { PlatformCapabilities } from '@bozonx/social-posting';

/** Largest message content Discord accepts. */
export const MAX_MESSAGE_LENGTH = 2_000;
/** Largest number of attachments one message may carry. */
export const MAX_ATTACHMENTS = 10;
/** Longest attachment description (alt text). */
export const MAX_ALT_TEXT_LENGTH = 1_024;

const MIB_BYTES = 1024 * 1024;

/**
 * Attachment size ceiling for a server with no boost.
 *
 * A floor, not a fact: the real ceiling rises with the guild's boost tier, and
 * `resolveCapabilities()` reads it per account. Declaring the highest tier here
 * would let the library promise an upload most servers refuse.
 */
export const DEFAULT_MAX_ATTACHMENT_BYTES = 10 * MIB_BYTES;

/** Attachment ceiling per guild premium tier, in bytes. */
export const ATTACHMENT_BYTES_BY_BOOST_TIER: Record<number, number> = {
  0: 10 * MIB_BYTES,
  1: 10 * MIB_BYTES,
  2: 50 * MIB_BYTES,
  3: 100 * MIB_BYTES,
};

/** Discord poll limits. */
export const MAX_POLL_ANSWERS = 10;
export const MAX_POLL_ANSWER_LENGTH = 55;
export const MAX_POLL_QUESTION_LENGTH = 300;
/** Polls run for whole hours, from one hour to 32 days. */
export const MIN_POLL_DURATION_SECS = 3_600;
export const MAX_POLL_DURATION_SECS = 768 * 3_600;

/**
 * Discord never fetches a URL: every file is uploaded to it as
 * `multipart/form-data`. A `url` source is still accepted because this adapter
 * downloads it first — which is why the transport is `both` rather than `push`,
 * and why `requiresPubliclyFetchableUrl` is absent: the URL has to be reachable
 * from this process, not from Discord.
 */
const attachment = {
  acceptedSources: ['url', 'bytes', 'blob', 'stream'] as const,
  transport: 'both' as const,
  maxBytes: DEFAULT_MAX_ATTACHMENT_BYTES,
};

/**
 * What Discord accepts, stated as data.
 *
 * Two things here are deliberately absent. There is no `shortVideo` or `story`:
 * Discord has no such product, and a vertical video is an ordinary attachment.
 * And `maxBytes` is the unboosted floor, because the real ceiling is a property
 * of the server rather than of the network.
 */
export const discordCapabilities: PlatformCapabilities = {
  name: 'discord',
  displayName: 'Discord',
  sources: [
    {
      url: 'https://docs.discord.com/developers/resources/message#create-message',
      supports: ['message content limit', 'attachment count', 'poll object'],
      verifiedAt: '2026-08-30',
    },
    {
      url: 'https://docs.discord.com/developers/resources/webhook#execute-webhook',
      supports: ['webhook execution', 'thread_id', 'wait parameter'],
      verifiedAt: '2026-08-30',
    },
    {
      url: 'https://docs.discord.com/developers/reference#uploading-files',
      supports: ['multipart/form-data attachment upload', 'attachment descriptions'],
      verifiedAt: '2026-08-30',
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
      minMediaCount: 2,
      maxMediaCount: MAX_ATTACHMENTS,
      // One message carries any mix of files; Discord draws no distinction.
      allowsMixedMedia: true,
    },
    [PostType.POLL]: {
      requiredFields: ['poll'],
      forbiddenFields: ['media'],
    },
  },

  maxBodyLength: MAX_MESSAGE_LENGTH,
  bodyLengthRule: {},

  // Discord renders its own Markdown flavour; HTML is not a thing there.
  supportedBodyFormats: ['text', 'md'],
  targetBodyFormat: 'md',

  media: {
    image: { ...attachment, acceptedSources: [...attachment.acceptedSources] },
    video: { ...attachment, acceptedSources: [...attachment.acceptedSources] },
    audio: { ...attachment, acceptedSources: [...attachment.acceptedSources] },
    document: { ...attachment, acceptedSources: [...attachment.acceptedSources] },
  },

  altText: { supported: true, maxLength: MAX_ALT_TEXT_LENGTH },

  // Discord has no per-message spoiler flag: a spoilered attachment is one
  // whose file name starts with `SPOILER_`.
  sensitive: { supportedValues: [false, true], default: false },

  // The channel is `target.id`. A guild id is not part of the address Discord
  // needs — the channel is globally unique — but it is what a permalink and the
  // boost-tier lookup are built from, so it is part of the address we keep.
  targetSchema: [
    {
      name: 'guildId',
      type: 'string',
      pattern: '^[0-9]{5,25}$',
      label: 'Server id',
      description: 'Guild the channel belongs to. Used for permalinks and boost-tier limits.',
    },
    {
      name: 'threadId',
      type: 'string',
      pattern: '^[0-9]{5,25}$',
      label: 'Thread id',
      description: 'Post into a thread of the channel rather than the channel itself.',
    },
  ],

  poll: {
    minOptions: 1,
    maxOptions: MAX_POLL_ANSWERS,
    maxOptionLength: MAX_POLL_ANSWER_LENGTH,
    minDurationSecs: MIN_POLL_DURATION_SECS,
    maxDurationSecs: MAX_POLL_DURATION_SECS,
    multiple: { supportedValues: [false, true], default: false },
    anonymous: { supportedValues: [false] },
  },

  supportsReply: true,
  supportsRepost: false,
  supportsQuote: false,

  extraFields: [
    { name: 'embeds', type: 'object', label: 'Embeds', description: 'Discord embed objects.' },
    { name: 'tts', type: 'boolean' },
    { name: 'flags', type: 'number' },
    { name: 'allowed_mentions', type: 'object' },
    { name: 'components', type: 'object' },
    {
      name: 'username',
      type: 'string',
      label: 'Override name',
      description: 'Webhook only: the name the message is posted under.',
    },
    {
      name: 'avatar_url',
      type: 'string',
      label: 'Override avatar',
      description: 'Webhook only: the avatar the message is posted with.',
    },
  ],
  allowUnknownExtraFields: false,

  auth: {
    kind: 'apiKey',
    // A webhook URL carries its own destination, so a target is not universally
    // required; `validateExtra()` requires one for bot-token accounts.
    requiresTarget: false,
    docsUrl: 'https://docs.discord.com/developers/resources/webhook#execute-webhook',
  },

  rateLimits: {
    note: 'Per-route buckets; hosts must honour retry_after from 429 responses. Discord does not publish a fixed per-channel message quota.',
  },

  supportsNativeScheduling: false,
  supportsDraft: false,
  supportsIdempotencyKey: false,
  supportsDeletion: true,

  ignoredFields: [
    'title',
    'description',
    'language',
    'tags',
    'thumbnail',
    'visibility',
    'contentWarning',
    'commentsEnabled',
    'location',
    'repostOf',
  ],
};
