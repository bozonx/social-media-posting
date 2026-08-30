import { PostType } from '@bozonx/social-posting';
import type { PlatformCapabilities } from '@bozonx/social-posting';
export const GRAPH_API_VERSION = 'v24.0';
export const CONTAINER_LIFETIME_SECS = 86400;
export const MAX_BODY_LENGTH = 2200;
const pull = {
  acceptedSources: ['url'] as const,
  transport: 'pull' as const,
  requiresPubliclyFetchableUrl: true,
  urlMustRemainAvailableForSecs: CONTAINER_LIFETIME_SECS,
};
export const instagramCapabilities: PlatformCapabilities = {
  name: 'instagram',
  displayName: 'Instagram',
  sources: [
    {
      url: 'https://developers.facebook.com/docs/instagram-platform/content-publishing/',
      supports: ['container creation', 'carousel', 'status', 'publish quota'],
      verifiedAt: '2026-08-30',
    },
  ],
  postTypes: {
    [PostType.IMAGE]: {
      requiredFields: ['media'],
      minMediaCount: 1,
      maxMediaCount: 1,
      mediaCounts: { image: { min: 1, max: 1 } },
      maxBodyLength: 2200,
    },
    [PostType.VIDEO]: {
      requiredFields: ['media'],
      minMediaCount: 1,
      maxMediaCount: 1,
      mediaCounts: { video: { min: 1, max: 1 } },
      maxBodyLength: 2200,
    },
    [PostType.SHORT_VIDEO]: {
      requiredFields: ['media'],
      minMediaCount: 1,
      maxMediaCount: 1,
      mediaCounts: { video: { min: 1, max: 1 } },
      maxBodyLength: 2200,
    },
    [PostType.STORY]: { requiredFields: ['media'], minMediaCount: 1, maxMediaCount: 1 },
    [PostType.ALBUM]: {
      requiredFields: ['media'],
      minMediaCount: 2,
      maxMediaCount: 10,
      maxBodyLength: 2200,
    },
  },
  maxBodyLength: 2200,
  maxTags: 30,
  tagFormat: 'hashtag',
  supportedBodyFormats: ['text'],
  targetBodyFormat: 'text',
  media: {
    image: { ...pull, acceptedSources: [...pull.acceptedSources] },
    video: { ...pull, acceptedSources: [...pull.acceptedSources] },
  },
  supportsReply: false,
  supportedVisibility: ['public'],
  defaultVisibility: 'public',
  auth: {
    kind: 'oauth2',
    scopes: ['instagram_basic', 'instagram_content_publish'],
    requiresTarget: true,
    docsUrl:
      'https://developers.facebook.com/docs/instagram/get-started/get-access-tokens-and-permissions',
  },
  extraFields: [
    { name: 'shareToFeed', type: 'boolean' },
    { name: 'locationId', type: 'string' },
    { name: 'coverUrl', type: 'string' },
    { name: 'thumbOffset', type: 'number', min: 0 },
  ],
  allowUnknownExtraFields: false,
  rateLimits: {
    postsPerDay: 100,
    quotaCost: { unit: 'publications', perPublish: 1 },
    quotaKind: 'rollingWindow',
    note: 'Rolling 24-hour content publishing limit; query content_publishing_limit for the account.',
  },
  supportsNativeScheduling: false,
  supportsDraft: false,
  supportsIdempotencyKey: false,
  supportsDeletion: false,
  supportsEdit: false,
  asyncProcessing: { supported: true, typicalSecs: 30, maxWaitSecs: 86400, pollIntervalSecs: 5 },
  ignoredFields: [
    'title',
    'description',
    'tags',
    'language',
    'sensitive',
    'contentWarning',
    'commentsEnabled',
    'location',
    'thumbnail',
    'repostOf',
  ],
};
