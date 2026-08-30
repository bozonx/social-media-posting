import { PostType } from '@bozonx/social-posting';
import type { PlatformCapabilities } from '@bozonx/social-posting';
export const GRAPH_API_VERSION = 'v24.0';
export const MAX_BODY_LENGTH = 63206;
export const VIDEO_CONTAINER_LIFETIME_SECS = 86400;
const pull = {
  acceptedSources: ['url'] as const,
  transport: 'pull' as const,
  requiresPubliclyFetchableUrl: true,
  urlMustRemainAvailableForSecs: VIDEO_CONTAINER_LIFETIME_SECS,
};
export const facebookCapabilities: PlatformCapabilities = {
  name: 'facebook',
  displayName: 'Facebook Pages',
  sources: [
    {
      url: 'https://developers.facebook.com/docs/pages-api/posts/',
      supports: ['Page feed', 'photos', 'videos', 'multi-photo posts'],
      verifiedAt: '2026-08-30',
    },
    {
      url: 'https://developers.facebook.com/docs/video-api/guides/reels-publishing/',
      supports: ['Reels container', 'status', 'finish'],
      verifiedAt: '2026-08-30',
    },
  ],
  postTypes: {
    [PostType.POST]: {
      requiredFields: ['body'],
      forbiddenFields: ['media', 'poll'],
      maxBodyLength: MAX_BODY_LENGTH,
    },
    [PostType.IMAGE]: {
      requiredFields: ['media'],
      minMediaCount: 1,
      maxMediaCount: 1,
      mediaCounts: { image: { min: 1, max: 1 } },
      maxBodyLength: MAX_BODY_LENGTH,
    },
    [PostType.ALBUM]: {
      requiredFields: ['media'],
      minMediaCount: 2,
      mediaCounts: { image: { min: 2 } },
      maxBodyLength: MAX_BODY_LENGTH,
    },
    [PostType.VIDEO]: {
      requiredFields: ['media'],
      minMediaCount: 1,
      maxMediaCount: 1,
      mediaCounts: { video: { min: 1, max: 1 } },
      maxBodyLength: MAX_BODY_LENGTH,
    },
    [PostType.SHORT_VIDEO]: {
      requiredFields: ['media'],
      minMediaCount: 1,
      maxMediaCount: 1,
      mediaCounts: { video: { min: 1, max: 1 } },
      maxBodyLength: MAX_BODY_LENGTH,
    },
  },
  maxBodyLength: MAX_BODY_LENGTH,
  supportedBodyFormats: ['text'],
  targetBodyFormat: 'text',
  media: {
    image: { ...pull, acceptedSources: [...pull.acceptedSources] },
    video: { ...pull, acceptedSources: [...pull.acceptedSources] },
  },
  supportedVisibility: ['public'],
  defaultVisibility: 'public',
  supportsReply: false,
  auth: {
    kind: 'oauth2',
    scopes: ['pages_manage_posts', 'pages_read_engagement'],
    requiresTarget: true,
    docsUrl: 'https://developers.facebook.com/docs/pages-api/posts/',
  },
  extraFields: [
    { name: 'link', type: 'string' },
    { name: 'placeId', type: 'string' },
    { name: 'published', type: 'boolean' },
  ],
  allowUnknownExtraFields: false,
  supportsNativeScheduling: true,
  minScheduleLeadSecs: 600,
  maxScheduleAheadSecs: 6480000,
  supportsDraft: false,
  supportsIdempotencyKey: false,
  supportsDeletion: false,
  supportsEdit: false,
  asyncProcessing: { supported: true, typicalSecs: 60, maxWaitSecs: 86400, pollIntervalSecs: 5 },
  ignoredFields: [
    'description',
    'tags',
    'language',
    'sensitive',
    'contentWarning',
    'commentsEnabled',
    'thumbnail',
    'inReplyTo',
    'repostOf',
    'poll',
  ],
};
