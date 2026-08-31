import { PostType, type PlatformCapabilities } from '@bozonx/social-posting';

export const blueskyCapabilities: PlatformCapabilities = {
  name: 'bluesky',
  displayName: 'Bluesky',
  sources: [
    {
      url: 'https://github.com/bluesky-social/atproto/tree/main/lexicons/app/bsky',
      supports: ['post records', 'facets', 'image and video embeds'],
      verifiedAt: '2026-08-30',
    },
  ],
  postTypes: {
    [PostType.POST]: { requiredFields: ['body'], forbiddenFields: ['media', 'poll'] },
    [PostType.IMAGE]: {
      requiredFields: ['media'],
      minMediaCount: 1,
      maxMediaCount: 4,
      mediaCounts: { image: { min: 1, max: 4 } },
      allowsMixedMedia: false,
    },
    [PostType.ALBUM]: {
      requiredFields: ['media'],
      minMediaCount: 2,
      maxMediaCount: 4,
      mediaCounts: { image: { min: 2, max: 4 } },
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
  },
  maxBodyLength: 300,
  bodyLengthRule: { countUnit: 'graphemes' },
  supportedBodyFormats: ['text', 'html', 'md'],
  targetBodyFormat: 'text',
  media: {
    image: {
      acceptedSources: ['url', 'bytes', 'blob', 'stream'],
      transport: 'push',
      mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
      maxBytes: 1_000_000,
    },
    video: {
      acceptedSources: ['url', 'bytes', 'blob', 'stream'],
      transport: 'push',
      mimeTypes: ['video/mp4'],
      containers: ['mp4'],
      maxBytes: 100_000_000,
      maxDurationSecs: 180,
    },
  },
  altText: { supported: true, maxLength: 2_000 },
  requiresApiBaseUrl: true,
  supportsReply: true,
  thread: { supported: true, maxSegments: 100, maxSegmentBodyLength: 300 },
  asyncProcessing: { supported: true, typicalSecs: 30, maxWaitSecs: 1_800, pollIntervalSecs: 5 },
  supportsNativeScheduling: false,
  supportsDraft: false,
  supportsDeletion: false,
  allowUnknownExtraFields: false,
  auth: { kind: 'custom', docsUrl: 'https://atproto.com/specs/xrpc#authentication' },
  ignoredFields: ['title', 'description'],
};
