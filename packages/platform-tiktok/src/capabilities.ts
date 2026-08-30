import { PostType } from '@bozonx/social-posting';
import type { MediaConstraints, PlatformCapabilities } from '@bozonx/social-posting';
const pull: MediaConstraints = {
  acceptedSources: ['url'],
  transport: 'pull',
  requiresPubliclyFetchableUrl: true,
};
export const tiktokCapabilities: PlatformCapabilities = {
  name: 'tiktok',
  displayName: 'TikTok',
  sources: [
    {
      url: 'https://developers.tiktok.com/doc/content-posting-api-reference-direct-post',
      supports: ['direct post', 'creator info', 'status'],
      verifiedAt: '2026-08-30',
    },
  ],
  postTypes: {
    [PostType.SHORT_VIDEO]: {
      requiredFields: ['media'],
      minMediaCount: 1,
      maxMediaCount: 1,
      mediaCounts: { video: { min: 1, max: 1 } },
    },
    [PostType.VIDEO]: {
      requiredFields: ['media'],
      minMediaCount: 1,
      maxMediaCount: 1,
      mediaCounts: { video: { min: 1, max: 1 } },
    },
    [PostType.IMAGE]: {
      requiredFields: ['media'],
      minMediaCount: 1,
      maxMediaCount: 1,
      mediaCounts: { image: { min: 1, max: 1 } },
    },
    [PostType.ALBUM]: {
      requiredFields: ['media'],
      minMediaCount: 2,
      maxMediaCount: 35,
      mediaCounts: { image: { min: 2, max: 35 } },
    },
  },
  supportedBodyFormats: ['text'],
  targetBodyFormat: 'text',
  media: { image: { ...pull }, video: { ...pull } },
  supportedVisibility: ['public', 'private'],
  defaultVisibility: 'public',
  supportsReply: false,
  auth: {
    kind: 'oauth2',
    scopes: ['video.publish'],
    docsUrl: 'https://developers.tiktok.com/doc/content-posting-api-get-started/',
  },
  extraFields: [
    { name: 'privacyLevel', type: 'string' },
    { name: 'disableComment', type: 'boolean' },
    { name: 'disableDuet', type: 'boolean' },
    { name: 'disableStitch', type: 'boolean' },
    { name: 'brandContentToggle', type: 'boolean' },
    { name: 'brandOrganicToggle', type: 'boolean' },
  ],
  allowUnknownExtraFields: false,
  supportsNativeScheduling: false,
  supportsDraft: false,
  supportsDeletion: false,
  supportsEdit: false,
  asyncProcessing: { supported: true, typicalSecs: 30, maxWaitSecs: 3600, pollIntervalSecs: 5 },
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
    'scheduledAt',
  ],
};
