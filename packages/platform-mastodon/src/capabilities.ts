import { PostType, type MediaConstraints, type PlatformCapabilities } from '@bozonx/social-posting';

const sources = [
  {
    url: 'https://docs.joinmastodon.org/methods/statuses/',
    supports: ['status publishing', 'polls', 'idempotency'],
    verifiedAt: '2026-08-30',
  },
];
const media: Record<'image' | 'video' | 'audio', MediaConstraints> = {
  image: {
    acceptedSources: ['url', 'bytes', 'blob', 'stream', 'platformRef'],
    transport: 'both' as const,
  },
  video: {
    acceptedSources: ['url', 'bytes', 'blob', 'stream', 'platformRef'],
    transport: 'both' as const,
  },
  audio: {
    acceptedSources: ['url', 'bytes', 'blob', 'stream', 'platformRef'],
    transport: 'both' as const,
  },
};

export const mastodonCapabilities: PlatformCapabilities = {
  name: 'mastodon',
  displayName: 'Mastodon',
  sources,
  postTypes: {
    [PostType.POST]: { requiredFields: ['body'], forbiddenFields: ['media', 'poll'] },
    [PostType.IMAGE]: {
      requiredFields: ['media'],
      minMediaCount: 1,
      maxMediaCount: 4,
      mediaCounts: { image: { min: 1 } },
    },
    [PostType.VIDEO]: {
      requiredFields: ['media'],
      minMediaCount: 1,
      maxMediaCount: 1,
      mediaCounts: { video: { min: 1, max: 1 } },
    },
    [PostType.SHORT_VIDEO]: {
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
    [PostType.ALBUM]: { requiredFields: ['media'], minMediaCount: 2, maxMediaCount: 4 },
    [PostType.POLL]: { requiredFields: ['body', 'poll'], forbiddenFields: ['media'] },
  },
  maxBodyLength: 500,
  supportedBodyFormats: ['text', 'html', 'md'],
  targetBodyFormat: 'text',
  media,
  altText: { supported: true, maxLength: 1500 },
  requiresApiBaseUrl: true,
  supportedVisibility: ['public', 'unlisted', 'private', 'direct'],
  defaultVisibility: 'public',
  supportsContentWarning: true,
  sensitive: { supportedValues: [false, true] },
  supportsReply: true,
  poll: {
    minOptions: 2,
    maxOptions: 4,
    maxOptionLength: 50,
    minDurationSecs: 300,
    maxDurationSecs: 2_628_000,
    multiple: { supportedValues: [false, true] },
  },
  thread: { supported: true, maxSegments: 100, maxSegmentBodyLength: 500 },
  supportsIdempotencyKey: true,
  supportsNativeScheduling: false,
  supportsDraft: false,
  supportsDeletion: false,
  allowUnknownExtraFields: false,
  auth: {
    kind: 'oauth2',
    scopes: ['write:statuses', 'write:media'],
    docsUrl: 'https://docs.joinmastodon.org/client/token/',
  },
  ignoredFields: ['title', 'description', 'tags'],
};

export const pixelfedCapabilities: PlatformCapabilities = {
  ...mastodonCapabilities,
  name: 'pixelfed',
  displayName: 'Pixelfed',
  sources: [
    {
      url: 'https://docs.pixelfed.org/technical-documentation/api/',
      supports: ['Mastodon-compatible API'],
      verifiedAt: '2026-08-30',
    },
  ],
  postTypes: {
    [PostType.IMAGE]: {
      requiredFields: ['media'],
      minMediaCount: 1,
      maxMediaCount: 4,
      mediaCounts: { image: { min: 1 } },
      allowsMixedMedia: false,
    },
    [PostType.VIDEO]: {
      requiredFields: ['media'],
      minMediaCount: 1,
      maxMediaCount: 1,
      mediaCounts: { video: { min: 1, max: 1 } },
    },
    [PostType.SHORT_VIDEO]: {
      requiredFields: ['media'],
      minMediaCount: 1,
      maxMediaCount: 1,
      mediaCounts: { video: { min: 1, max: 1 } },
    },
    [PostType.ALBUM]: {
      requiredFields: ['media'],
      minMediaCount: 2,
      maxMediaCount: 4,
      mediaCounts: { image: { min: 2 } },
      allowsMixedMedia: false,
    },
  },
  media: { image: media.image, video: media.video },
};
