import { PostType } from '@bozonx/social-posting';
import type { PlatformCapabilities } from '@bozonx/social-posting';
export const GRAPH_API_VERSION = 'v24.0';
export const CONTAINER_LIFETIME_SECS = 86400;
export const MAX_BODY_LENGTH = 500;
const pull = {
  acceptedSources: ['url'] as const,
  transport: 'pull' as const,
  requiresPubliclyFetchableUrl: true,
  urlMustRemainAvailableForSecs: CONTAINER_LIFETIME_SECS,
};
export const threadsCapabilities: PlatformCapabilities = {
  name: 'threads',
  displayName: 'Threads',
  sources: [
    {
      url: 'https://developers.facebook.com/docs/threads/posts/',
      supports: ['container creation', 'carousel', 'status', 'publish'],
      verifiedAt: '2026-08-30',
    },
  ],
  postTypes: {
    [PostType.POST]: {
      requiredFields: ['body'],
      forbiddenFields: ['media', 'poll'],
      maxBodyLength: 500,
    },
    [PostType.IMAGE]: {
      requiredFields: ['media'],
      minMediaCount: 1,
      maxMediaCount: 1,
      mediaCounts: { image: { min: 1, max: 1 } },
      maxBodyLength: 500,
    },
    [PostType.VIDEO]: {
      requiredFields: ['media'],
      minMediaCount: 1,
      maxMediaCount: 1,
      mediaCounts: { video: { min: 1, max: 1 } },
      maxBodyLength: 500,
    },
    [PostType.SHORT_VIDEO]: {
      requiredFields: ['media'],
      minMediaCount: 1,
      maxMediaCount: 1,
      mediaCounts: { video: { min: 1, max: 1 } },
      maxBodyLength: 500,
    },
    [PostType.ALBUM]: {
      requiredFields: ['media'],
      minMediaCount: 2,
      maxMediaCount: 20,
      maxBodyLength: 500,
    },
  },
  maxBodyLength: 500,
  supportedBodyFormats: ['text'],
  targetBodyFormat: 'text',
  media: {
    image: { ...pull, acceptedSources: [...pull.acceptedSources] },
    video: { ...pull, acceptedSources: [...pull.acceptedSources] },
  },
  supportsReply: true,
  supportedVisibility: ['public'],
  defaultVisibility: 'public',
  auth: {
    kind: 'oauth2',
    scopes: ['threads_basic', 'threads_content_publish'],
    requiresTarget: true,
    docsUrl:
      'https://developers.facebook.com/docs/threads/get-started/get-access-tokens-and-permissions',
  },
  extraFields: [
    {
      name: 'replyControl',
      type: 'enum',
      values: ['everyone', 'accounts_you_follow', 'mentioned_only'],
    },
    { name: 'quotePostId', type: 'string' },
  ],
  allowUnknownExtraFields: false,
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
