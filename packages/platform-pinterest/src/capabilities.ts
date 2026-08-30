import { PostType } from '@bozonx/social-posting';
import type { MediaConstraints, PlatformCapabilities } from '@bozonx/social-posting';
const pull: MediaConstraints = {
  acceptedSources: ['url'],
  transport: 'pull',
  requiresPubliclyFetchableUrl: true,
};
export const pinterestCapabilities: PlatformCapabilities = {
  name: 'pinterest',
  displayName: 'Pinterest',
  sources: [
    {
      url: 'https://developers.pinterest.com/docs/api/v5/pins-create',
      supports: ['image Pins', 'video Pins'],
      verifiedAt: '2026-08-30',
    },
  ],
  postTypes: {
    [PostType.IMAGE]: {
      requiredFields: ['media', 'title'],
      minMediaCount: 1,
      maxMediaCount: 1,
      mediaCounts: { image: { min: 1, max: 1 } },
      maxTitleLength: 100,
      maxDescriptionLength: 800,
    },
    [PostType.VIDEO]: {
      requiredFields: ['media', 'title', 'thumbnail'],
      minMediaCount: 1,
      maxMediaCount: 1,
      mediaCounts: { video: { min: 1, max: 1 } },
      maxTitleLength: 100,
      maxDescriptionLength: 800,
    },
  },
  supportedBodyFormats: ['text'],
  targetBodyFormat: 'text',
  media: {
    image: { ...pull },
    video: { acceptedSources: ['platformRef'], transport: 'push', requiresCover: true },
  },
  thumbnail: { supported: true },
  supportedVisibility: ['public'],
  defaultVisibility: 'public',
  supportsReply: false,
  targetSchema: [{ name: 'sectionId', type: 'string' }],
  auth: {
    kind: 'oauth2',
    scopes: ['pins:write', 'boards:read'],
    requiresTarget: true,
    docsUrl: 'https://developers.pinterest.com/docs/api/v5/pins-create',
  },
  extraFields: [
    { name: 'link', type: 'string' },
    { name: 'altText', type: 'string', maxLength: 500 },
  ],
  allowUnknownExtraFields: false,
  supportsNativeScheduling: false,
  supportsDraft: false,
  supportsDeletion: false,
  supportsEdit: false,
  asyncProcessing: { supported: false },
  ignoredFields: [
    'tags',
    'language',
    'sensitive',
    'contentWarning',
    'commentsEnabled',
    'inReplyTo',
    'repostOf',
    'poll',
    'scheduledAt',
  ],
};
