import { PostType } from '@bozonx/social-posting';
import type { MediaConstraints, PlatformCapabilities } from '@bozonx/social-posting';
const ref: MediaConstraints = { acceptedSources: ['platformRef'], transport: 'push' };
export const xCapabilities: PlatformCapabilities = {
  name: 'x',
  displayName: 'X',
  sources: [
    {
      url: 'https://docs.x.com/x-api/posts/create-manage-posts',
      supports: ['posts', 'media references', 'polls', 'replies', 'quotes'],
      verifiedAt: '2026-08-30',
    },
  ],
  postTypes: {
    [PostType.POST]: {
      requiredFields: ['body'],
      forbiddenFields: ['media', 'poll'],
      maxBodyLength: 280,
    },
    [PostType.IMAGE]: {
      requiredFields: ['media'],
      minMediaCount: 1,
      maxMediaCount: 4,
      mediaCounts: { image: { min: 1, max: 4 } },
      maxBodyLength: 280,
    },
    [PostType.VIDEO]: {
      requiredFields: ['media'],
      minMediaCount: 1,
      maxMediaCount: 1,
      mediaCounts: { video: { min: 1, max: 1 } },
      maxBodyLength: 280,
    },
    [PostType.POLL]: { requiredFields: ['poll'], maxBodyLength: 280 },
  },
  maxBodyLength: 280,
  bodyLengthRule: { countUnit: 'utf16', urlWeight: 23 },
  supportedBodyFormats: ['text'],
  targetBodyFormat: 'text',
  media: { image: { ...ref }, video: { ...ref } },
  supportedVisibility: ['public'],
  defaultVisibility: 'public',
  supportsReply: true,
  supportsQuote: true,
  supportsRepost: false,
  poll: {
    minOptions: 2,
    maxOptions: 4,
    maxOptionLength: 25,
    minDurationSecs: 300,
    maxDurationSecs: 10080,
    multiple: { supportedValues: [false] },
    anonymous: { supportedValues: [true] },
  },
  auth: {
    kind: 'oauth2',
    scopes: ['tweet.read', 'tweet.write', 'users.read', 'offline.access'],
    docsUrl: 'https://docs.x.com/x-api/posts/manage-tweets/introduction',
  },
  extraFields: [
    {
      name: 'replySettings',
      type: 'enum',
      values: ['following', 'mentionedUsers', 'subscribers', 'verified'],
    },
    { name: 'communityId', type: 'string' },
  ],
  allowUnknownExtraFields: false,
  supportsNativeScheduling: false,
  supportsDraft: false,
  supportsDeletion: false,
  supportsEdit: false,
  asyncProcessing: { supported: false },
  ignoredFields: [
    'description',
    'tags',
    'language',
    'sensitive',
    'contentWarning',
    'commentsEnabled',
    'thumbnail',
    'scheduledAt',
  ],
};
