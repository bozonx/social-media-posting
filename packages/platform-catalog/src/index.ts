import { PostType, type PlatformCapabilities } from '@bozonx/social-posting';

export type PlatformApiAvailability = 'available' | 'restricted' | 'unavailable';

export interface PlatformProfile {
  key: string;
  displayName: string;
  apiAvailability: PlatformApiAvailability;
  capabilities: PlatformCapabilities | null;
  notes?: string;
}

const allUploadSources = ['url', 'bytes', 'blob', 'stream', 'platformRef'] as const;
const directUploadSources = ['bytes', 'blob', 'stream', 'platformRef'] as const;
const verifiedAt = '2026-08-29';

export const platformProfiles = {
  facebook: profile('facebook', 'Facebook', 'available', {
    postTypes: {
      [PostType.POST]: { requiredFields: ['body'], maxBodyLength: 63_206 },
      [PostType.IMAGE]: { requiredFields: ['media'], minMediaCount: 1 },
      [PostType.VIDEO]: { requiredFields: ['media'], minMediaCount: 1, maxMediaCount: 1 },
    },
    media: genericVisualMedia(),
    auth: {
      kind: 'oauth2',
      requiresTarget: true,
      docsUrl: 'https://developers.facebook.com/docs/pages-api/posts/',
    },
    sources: source('https://developers.facebook.com/docs/pages-api/posts/', ['Page publishing']),
  }),
  threads: profile('threads', 'Threads', 'available', {
    postTypes: {
      [PostType.POST]: { requiredFields: ['body'], maxBodyLength: 500 },
      [PostType.IMAGE]: {
        requiredFields: ['media'],
        minMediaCount: 1,
        maxMediaCount: 1,
        maxBodyLength: 500,
      },
      [PostType.VIDEO]: {
        requiredFields: ['media'],
        minMediaCount: 1,
        maxMediaCount: 1,
        maxBodyLength: 500,
      },
      [PostType.ALBUM]: {
        requiredFields: ['media'],
        minMediaCount: 2,
        maxMediaCount: 20,
        maxBodyLength: 500,
      },
    },
    media: genericVisualMedia(['url']),
    supportsReply: true,
    auth: { kind: 'oauth2', docsUrl: 'https://developers.facebook.com/docs/threads/posts/' },
    sources: source('https://developers.facebook.com/docs/threads/posts/', [
      'text and media containers',
    ]),
  }),
  instagram: profile('instagram', 'Instagram', 'available', {
    postTypes: {
      [PostType.IMAGE]: {
        requiredFields: ['media'],
        minMediaCount: 1,
        maxMediaCount: 1,
        maxBodyLength: 2_200,
      },
      [PostType.VIDEO]: {
        requiredFields: ['media'],
        minMediaCount: 1,
        maxMediaCount: 1,
        maxBodyLength: 2_200,
      },
      [PostType.ALBUM]: {
        requiredFields: ['media'],
        minMediaCount: 2,
        maxMediaCount: 10,
        maxBodyLength: 2_200,
      },
      [PostType.STORY]: { requiredFields: ['media'], minMediaCount: 1, maxMediaCount: 1 },
    },
    maxTags: 30,
    tagFormat: 'hashtag',
    media: {
      image: { acceptedSources: ['url'], mimeTypes: ['image/jpeg'] },
      video: { acceptedSources: ['url', 'bytes', 'blob', 'stream', 'platformRef'] },
    },
    rateLimits: { postsPerDay: 100, note: 'Rolling 24-hour content publishing limit.' },
    auth: {
      kind: 'oauth2',
      docsUrl: 'https://developers.facebook.com/docs/instagram-platform/content-publishing/',
    },
    sources: source('https://developers.facebook.com/docs/instagram-platform/content-publishing/', [
      'publishing flow',
      'carousel and media constraints',
      'rate limit',
    ]),
  }),
  whatsappChannels: unavailable(
    'whatsappChannels',
    'WhatsApp Channels',
    'No documented public WhatsApp Cloud API endpoint publishes Channel updates.',
    'https://faq.whatsapp.com/265055289421317',
  ),
  youtube: profile('youtube', 'YouTube', 'available', {
    postTypes: {
      [PostType.VIDEO]: {
        requiredFields: ['media', 'title'],
        minMediaCount: 1,
        maxMediaCount: 1,
        maxTitleLength: 100,
        maxDescriptionLength: 5_000,
        maxTagsLength: 500,
      },
    },
    media: {
      video: {
        acceptedSources: directUploadSources.slice(),
        mimeTypes: ['application/octet-stream'],
        maxBytes: 256 * 1024 ** 3,
      },
    },
    thumbnail: { supported: true },
    supportedVisibility: ['public', 'private', 'unlisted'],
    auth: {
      kind: 'oauth2',
      docsUrl: 'https://developers.google.com/youtube/v3/docs/videos/insert',
    },
    sources: source('https://developers.google.com/youtube/v3/docs/videos/insert', [
      'video upload and file size',
    ]),
  }),
  vimeo: profile('vimeo', 'Vimeo', 'available', {
    postTypes: {
      [PostType.VIDEO]: { requiredFields: ['media'], minMediaCount: 1, maxMediaCount: 1 },
    },
    media: {
      video: {
        acceptedSources: allUploadSources.slice(),
        maxBytes: 300 * 1024 ** 3,
        maxDurationSecs: 86_400,
      },
    },
    auth: {
      kind: 'oauth2',
      scopes: ['upload', 'edit'],
      docsUrl: 'https://developer.vimeo.com/api/upload/videos',
    },
    sources: source('https://developer.vimeo.com/api/upload/videos', [
      'upload methods',
      'file size and duration',
    ]),
  }),
  tiktok: profile(
    'tiktok',
    'TikTok',
    'restricted',
    {
      postTypes: {
        [PostType.VIDEO]: { requiredFields: ['media'], minMediaCount: 1, maxMediaCount: 1 },
        [PostType.ALBUM]: { requiredFields: ['media'], minMediaCount: 1, maxMediaCount: 35 },
      },
      media: {
        video: {
          acceptedSources: ['url', 'bytes', 'blob', 'stream'],
          mimeTypes: ['video/mp4', 'video/quicktime', 'video/webm'],
        },
        image: { acceptedSources: ['url'] },
      },
      auth: {
        kind: 'oauth2',
        scopes: ['video.publish'],
        docsUrl: 'https://developers.tiktok.com/doc/content-posting-api-get-started/',
      },
      sources: source(
        'https://developers.tiktok.com/doc/content-posting-api-reference-upload-video/',
        ['upload flow', 'video MIME types'],
      ),
    },
    'Direct posting requires app review and user-facing creator controls.',
  ),
  mastodon: profile(
    'mastodon',
    'Mastodon',
    'available',
    {
      postTypes: {
        [PostType.POST]: { requiredFields: ['body'] },
        [PostType.IMAGE]: { requiredFields: ['media'], minMediaCount: 1, maxMediaCount: 4 },
        [PostType.VIDEO]: { requiredFields: ['media'], minMediaCount: 1, maxMediaCount: 1 },
        [PostType.POLL]: { requiredFields: ['poll'] },
      },
      media: genericMedia(),
      supportsContentWarning: true,
      supportsReply: true,
      sensitive: { supportedValues: [false, true] },
      supportedVisibility: ['public', 'unlisted', 'private', 'direct'],
      supportsIdempotencyKey: true,
      auth: {
        kind: 'oauth2',
        scopes: ['write:statuses'],
        docsUrl: 'https://docs.joinmastodon.org/methods/statuses/',
      },
      sources: source('https://docs.joinmastodon.org/methods/statuses/', ['status publishing']),
    },
    'Character and media limits are instance configuration and must be discovered at runtime.',
  ),
  x: profile('x', 'X', 'available', {
    postTypes: {
      [PostType.POST]: { requiredFields: ['body'], maxBodyLength: 280 },
      [PostType.IMAGE]: {
        requiredFields: ['media'],
        minMediaCount: 1,
        maxMediaCount: 4,
        maxBodyLength: 280,
      },
      [PostType.VIDEO]: {
        requiredFields: ['media'],
        minMediaCount: 1,
        maxMediaCount: 1,
        maxBodyLength: 280,
      },
      [PostType.POLL]: { requiredFields: ['poll'], maxBodyLength: 280 },
    },
    bodyLengthRule: { urlWeight: 23 },
    media: genericVisualMedia(directUploadSources.slice()),
    supportsReply: true,
    supportsRepost: true,
    supportsQuote: true,
    auth: { kind: 'oauth2', docsUrl: 'https://docs.x.com/x-api/posts/manage-tweets/introduction' },
    sources: source('https://docs.x.com/fundamentals/counting-characters', [
      'weighted character counting',
    ]),
  }),
  bluesky: profile('bluesky', 'Bluesky', 'available', {
    postTypes: {
      [PostType.POST]: { requiredFields: ['body'], maxBodyLength: 300 },
      [PostType.IMAGE]: {
        requiredFields: ['media'],
        minMediaCount: 1,
        maxMediaCount: 4,
        maxBodyLength: 300,
      },
      [PostType.VIDEO]: {
        requiredFields: ['media'],
        minMediaCount: 1,
        maxMediaCount: 1,
        maxBodyLength: 300,
      },
    },
    media: genericVisualMedia(directUploadSources.slice()),
    supportsReply: true,
    supportsRepost: true,
    supportsQuote: true,
    auth: { kind: 'custom', docsUrl: 'https://docs.bsky.app/docs/advanced-guides/posts' },
    sources: source('https://docs.bsky.app/docs/advanced-guides/posts', [
      'post records and embeds',
    ]),
  }),
  diaspora: unavailable(
    'diaspora',
    'diaspora*',
    'diaspora* has no stable, official cross-pod publishing API.',
    'https://diasporafoundation.org/',
  ),
  snapchat: profile(
    'snapchat',
    'Snapchat',
    'restricted',
    {
      postTypes: {
        [PostType.STORY]: { requiredFields: ['media'], minMediaCount: 1, maxMediaCount: 1 },
      },
      media: genericVisualMedia(directUploadSources.slice()),
      auth: {
        kind: 'oauth2',
        docsUrl: 'https://developers.snap.com/api/marketing-api/Public-Profile-API/Introduction',
      },
      sources: source(
        'https://developers.snap.com/api/marketing-api/Public-Profile-API/Introduction',
        ['Public Profile API access'],
      ),
    },
    'Organic publishing access is restricted to approved Public Profile API integrations.',
  ),
  discord: profile('discord', 'Discord', 'available', {
    postTypes: {
      [PostType.POST]: { requiredFields: ['body'], maxBodyLength: 2_000 },
      [PostType.IMAGE]: {
        requiredFields: ['media'],
        minMediaCount: 1,
        maxMediaCount: 10,
        maxBodyLength: 2_000,
      },
      [PostType.AUDIO]: {
        requiredFields: ['media'],
        minMediaCount: 1,
        maxMediaCount: 10,
        maxBodyLength: 2_000,
      },
      [PostType.DOCUMENT]: {
        requiredFields: ['media'],
        minMediaCount: 1,
        maxMediaCount: 10,
        maxBodyLength: 2_000,
      },
      [PostType.POLL]: { requiredFields: ['poll'] },
    },
    media: genericMedia(),
    altText: { supported: true, maxLength: 1_024 },
    auth: {
      kind: 'apiKey',
      requiresTarget: true,
      docsUrl: 'https://docs.discord.com/developers/resources/message#create-message',
    },
    sources: source('https://docs.discord.com/developers/resources/message#create-message', [
      'message content and attachment request limits',
    ]),
  }),
  pinterest: profile('pinterest', 'Pinterest', 'available', {
    postTypes: {
      [PostType.IMAGE]: {
        requiredFields: ['media', 'title'],
        minMediaCount: 1,
        maxMediaCount: 1,
        maxTitleLength: 100,
        maxDescriptionLength: 800,
      },
      [PostType.VIDEO]: {
        requiredFields: ['media', 'title'],
        minMediaCount: 1,
        maxMediaCount: 1,
        maxTitleLength: 100,
        maxDescriptionLength: 800,
      },
    },
    media: genericVisualMedia(),
    thumbnail: { supported: true },
    auth: {
      kind: 'oauth2',
      scopes: ['pins:write'],
      requiresTarget: true,
      docsUrl:
        'https://developers.pinterest.com/docs/work-with-organic-content-and-users/create-boards-and-pins/',
    },
    sources: source(
      'https://developers.pinterest.com/docs/work-with-organic-content-and-users/create-boards-and-pins/',
      ['organic Pin publishing'],
    ),
  }),
  linkedin: profile(
    'linkedin',
    'LinkedIn',
    'restricted',
    {
      postTypes: {
        [PostType.POST]: { requiredFields: ['body'], maxBodyLength: 3_000 },
        [PostType.IMAGE]: {
          requiredFields: ['media'],
          minMediaCount: 1,
          maxMediaCount: 20,
          maxBodyLength: 3_000,
        },
        [PostType.VIDEO]: {
          requiredFields: ['media'],
          minMediaCount: 1,
          maxMediaCount: 1,
          maxBodyLength: 3_000,
        },
        [PostType.DOCUMENT]: {
          requiredFields: ['media'],
          minMediaCount: 1,
          maxMediaCount: 1,
          maxBodyLength: 3_000,
        },
      },
      media: genericMedia(directUploadSources.slice()),
      auth: {
        kind: 'oauth2',
        docsUrl:
          'https://learn.microsoft.com/linkedin/marketing/community-management/shares/posts-api',
      },
      sources: source(
        'https://learn.microsoft.com/linkedin/marketing/community-management/shares/posts-api',
        ['Posts API'],
      ),
    },
    'Member and organization publishing permissions require LinkedIn product approval.',
  ),
  reddit: profile(
    'reddit',
    'Reddit',
    'available',
    {
      postTypes: {
        [PostType.POST]: {
          requiredFields: ['title', 'body'],
          maxTitleLength: 300,
          maxBodyLength: 40_000,
        },
        [PostType.IMAGE]: {
          requiredFields: ['title', 'media'],
          minMediaCount: 1,
          maxMediaCount: 1,
          maxTitleLength: 300,
        },
        [PostType.VIDEO]: {
          requiredFields: ['title', 'media'],
          minMediaCount: 1,
          maxMediaCount: 1,
          maxTitleLength: 300,
        },
      },
      media: genericVisualMedia(),
      sensitive: { supportedValues: [false, true] },
      auth: {
        kind: 'oauth2',
        requiresTarget: true,
        docsUrl: 'https://www.reddit.com/dev/api/#POST_api_submit',
      },
      sources: source('https://www.reddit.com/dev/api/#POST_api_submit', [
        'submission API and title limit',
      ]),
    },
    'Subreddit-specific requirements must be fetched before submission.',
  ),
  twitch: profile(
    'twitch',
    'Twitch',
    'restricted',
    {
      postTypes: {
        [PostType.VIDEO]: { requiredFields: ['media'], minMediaCount: 1, maxMediaCount: 1 },
      },
      media: { video: { acceptedSources: directUploadSources.slice() } },
      auth: { kind: 'oauth2', docsUrl: 'https://dev.twitch.tv/docs/api/videos/' },
      sources: source('https://dev.twitch.tv/docs/api/videos/', ['video API availability']),
    },
    'The public API manages clips and videos but does not provide a general social post upload endpoint.',
  ),
  kwai: profile(
    'kwai',
    'Kwai',
    'restricted',
    {
      postTypes: {
        [PostType.VIDEO]: { requiredFields: ['media'], minMediaCount: 1, maxMediaCount: 1 },
      },
      media: { video: { acceptedSources: directUploadSources.slice() } },
      auth: { kind: 'oauth2', docsUrl: 'https://developers.kwai.com/' },
      sources: source('https://developers.kwai.com/', ['developer program']),
    },
    'Publishing documentation and access are region- and partner-program dependent.',
  ),
  dailymotion: profile('dailymotion', 'Dailymotion', 'available', {
    postTypes: {
      [PostType.VIDEO]: { requiredFields: ['media', 'title'], minMediaCount: 1, maxMediaCount: 1 },
    },
    media: { video: { acceptedSources: directUploadSources.slice() } },
    auth: { kind: 'oauth2', docsUrl: 'https://developers.dailymotion.com/guides/upload-videos/' },
    sources: source('https://developers.dailymotion.com/guides/upload-videos/', [
      'video upload flow',
    ]),
  }),
} as const satisfies Record<string, PlatformProfile>;

export type PlatformProfileKey = keyof typeof platformProfiles;

export function getPlatformProfile(key: PlatformProfileKey): PlatformProfile {
  return platformProfiles[key];
}

function profile(
  key: string,
  displayName: string,
  apiAvailability: PlatformApiAvailability,
  capabilities: Omit<PlatformCapabilities, 'name' | 'displayName'>,
  notes?: string,
): PlatformProfile {
  return {
    key,
    displayName,
    apiAvailability,
    capabilities: { name: key, displayName, ...capabilities },
    notes,
  };
}

function unavailable(
  key: string,
  displayName: string,
  notes: string,
  url: string,
): PlatformProfile {
  return {
    key,
    displayName,
    apiAvailability: 'unavailable',
    capabilities: null,
    notes: `${notes} Official reference: ${url}`,
  };
}

function source(url: string, supports: string[]) {
  return [{ url, supports, verifiedAt }];
}

function genericVisualMedia(acceptedSources = allUploadSources.slice()) {
  return {
    image: { acceptedSources: [...acceptedSources] },
    video: { acceptedSources: [...acceptedSources] },
  };
}

function genericMedia(acceptedSources = allUploadSources.slice()) {
  return {
    ...genericVisualMedia(acceptedSources),
    audio: { acceptedSources: [...acceptedSources] },
    document: { acceptedSources: [...acceptedSources] },
  };
}
