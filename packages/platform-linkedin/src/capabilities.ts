import { PostType } from '@bozonx/social-posting';
import type { MediaConstraints, PlatformCapabilities } from '@bozonx/social-posting';
const push: MediaConstraints = { acceptedSources: ['platformRef'], transport: 'push' };
export const LINKEDIN_VERSION = '202608';
export const linkedinCapabilities: PlatformCapabilities = {
  name: 'linkedin',
  displayName: 'LinkedIn',
  sources: [
    {
      url: 'https://learn.microsoft.com/linkedin/marketing/community-management/shares/posts-api',
      supports: ['posts', 'images', 'videos', 'documents'],
      verifiedAt: '2026-08-30',
    },
  ],
  postTypes: {
    [PostType.POST]: {
      requiredFields: ['body'],
      forbiddenFields: ['media', 'poll'],
      maxBodyLength: 3000,
    },
    [PostType.IMAGE]: {
      requiredFields: ['media'],
      minMediaCount: 1,
      maxMediaCount: 20,
      mediaCounts: { image: { min: 1, max: 20 } },
      maxBodyLength: 3000,
    },
    [PostType.VIDEO]: {
      requiredFields: ['media'],
      minMediaCount: 1,
      maxMediaCount: 1,
      mediaCounts: { video: { min: 1, max: 1 } },
      maxBodyLength: 3000,
    },
    [PostType.SHORT_VIDEO]: {
      requiredFields: ['media'],
      minMediaCount: 1,
      maxMediaCount: 1,
      mediaCounts: { video: { min: 1, max: 1 } },
      maxBodyLength: 3000,
    },
    [PostType.DOCUMENT]: {
      requiredFields: ['media'],
      minMediaCount: 1,
      maxMediaCount: 1,
      mediaCounts: { document: { min: 1, max: 1 } },
      maxBodyLength: 3000,
    },
  },
  maxBodyLength: 3000,
  supportedBodyFormats: ['text'],
  targetBodyFormat: 'text',
  media: { image: { ...push }, video: { ...push }, document: { ...push } },
  supportedVisibility: ['public'],
  defaultVisibility: 'public',
  supportsReply: false,
  targetSchema: [{ name: 'authorType', type: 'enum', values: ['person', 'organization'] }],
  auth: {
    kind: 'oauth2',
    scopes: ['w_member_social', 'w_organization_social'],
    requiresTarget: true,
    docsUrl: 'https://learn.microsoft.com/linkedin/marketing/community-management/shares/posts-api',
  },
  extraFields: [
    { name: 'distributionFeed', type: 'enum', values: ['MAIN_FEED', 'NONE'] },
    { name: 'commentsEnabled', type: 'boolean' },
  ],
  allowUnknownExtraFields: false,
  supportsNativeScheduling: false,
  supportsDraft: false,
  supportsIdempotencyKey: false,
  supportsDeletion: false,
  supportsEdit: false,
  asyncProcessing: { supported: false },
  ignoredFields: [
    'description',
    'tags',
    'language',
    'sensitive',
    'contentWarning',
    'thumbnail',
    'inReplyTo',
    'repostOf',
    'poll',
    'scheduledAt',
  ],
};
