import {
  PostType,
  type MediaConstraints,
  type MediaType as MediaKindName,
  type PlatformCapabilities,
} from '@bozonx/social-posting';

export type PlatformApiAvailability = 'available' | 'restricted' | 'unavailable';

export interface PlatformProfile {
  key: string;
  displayName: string;
  apiAvailability: PlatformApiAvailability;
  capabilities: PlatformCapabilities | null;
  notes?: string;
}

const directUploadSources = ['bytes', 'blob', 'stream', 'platformRef'] as const;
const verifiedAt = '2026-08-29';

export const platformProfiles = {
  facebook: profile(
    'facebook',
    'Facebook',
    'available',
    {
      postTypes: {
        [PostType.POST]: { requiredFields: ['body'], maxBodyLength: 63_206 },
        [PostType.IMAGE]: { requiredFields: ['media'], minMediaCount: 1 },
        [PostType.VIDEO]: { requiredFields: ['media'], minMediaCount: 1, maxMediaCount: 1 },
      },
      auth: {
        kind: 'oauth2',
        requiresTarget: true,
        docsUrl: 'https://developers.facebook.com/docs/pages-api/posts/',
      },
      sources: source('https://developers.facebook.com/docs/pages-api/posts/', ['Page publishing']),
    },
    'Media transport and per-kind limits are not stated by the cited source and are deliberately absent.',
  ),
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
    media: pullMedia(['image', 'video']),
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
      [PostType.SHORT_VIDEO]: {
        requiredFields: ['media'],
        minMediaCount: 1,
        maxMediaCount: 1,
        maxBodyLength: 2_200,
      },
      [PostType.STORY]: { requiredFields: ['media'], minMediaCount: 1, maxMediaCount: 1 },
    },
    maxTags: 30,
    tagFormat: 'hashtag',
    media: {
      image: {
        acceptedSources: ['url'],
        transport: 'pull',
        requiresPubliclyFetchableUrl: true,
        mimeTypes: ['image/jpeg'],
      },
      video: { acceptedSources: ['url'], transport: 'pull', requiresPubliclyFetchableUrl: true },
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
  youtube: profile(
    'youtube',
    'YouTube',
    'available',
    {
      postTypes: {
        [PostType.VIDEO]: {
          requiredFields: ['media', 'title'],
          minMediaCount: 1,
          maxMediaCount: 1,
          maxTitleLength: 100,
          maxDescriptionLength: 5_000,
          maxTagsLength: 500,
        },
        // Shorts have no endpoint of their own: the same `videos.insert`, with
        // the classification decided by YouTube from the finished file.
        [PostType.SHORT_VIDEO]: {
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
          // `both` rather than `push`: a URL is accepted and downloaded here
          // first. YouTube itself never fetches one.
          acceptedSources: ['url', ...directUploadSources.filter(kind => kind !== 'platformRef')],
          transport: 'both',
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
    },
    'A released adapter ships the authoritative descriptor for this network; prefer `@bozonx/social-posting-youtube` over this profile, which stays for hosts that only need to plan against the network without depending on the adapter.',
  ),
  vimeo: profile(
    'vimeo',
    'Vimeo',
    'available',
    {
      postTypes: {
        [PostType.VIDEO]: { requiredFields: ['media'], minMediaCount: 1, maxMediaCount: 1 },
      },
      media: {
        video: {
          // No `platformRef`: Vimeo has no re-usable file ids.
          acceptedSources: ['url', 'bytes', 'blob', 'stream'],
          transport: 'both',
          maxBytes: 256 * 1024 ** 3,
          requiresPubliclyFetchableUrl: true,
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
    },
    'A released adapter ships the authoritative descriptor for this network; prefer `@bozonx/social-posting-vimeo` over this profile, which stays for hosts that only need to plan against the network without depending on the adapter.',
  ),
  tiktok: profile(
    'tiktok',
    'TikTok',
    'restricted',
    {
      postTypes: {
        [PostType.SHORT_VIDEO]: { requiredFields: ['media'], minMediaCount: 1, maxMediaCount: 1 },
        [PostType.ALBUM]: { requiredFields: ['media'], minMediaCount: 2, maxMediaCount: 35 },
      },
      media: {
        video: {
          acceptedSources: ['url', 'bytes', 'blob', 'stream'],
          transport: 'both',
          mimeTypes: ['video/mp4', 'video/quicktime', 'video/webm'],
        },
        image: {
          acceptedSources: ['url'],
          transport: 'pull',
          requiresPubliclyFetchableUrl: true,
          requiresCover: true,
        },
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
      media: pushMedia(['image', 'video', 'audio', 'document']),
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
  pixelfed: profile(
    'pixelfed',
    'Pixelfed',
    'available',
    {
      postTypes: {
        [PostType.IMAGE]: { requiredFields: ['media'], minMediaCount: 1, maxMediaCount: 4 },
        [PostType.VIDEO]: { requiredFields: ['media'], minMediaCount: 1, maxMediaCount: 1 },
        [PostType.ALBUM]: { requiredFields: ['media'], minMediaCount: 2, maxMediaCount: 4 },
      },
      media: pushMedia(['image', 'video']),
      supportsContentWarning: true,
      supportsReply: true,
      sensitive: { supportedValues: [false, true] },
      supportedVisibility: ['public', 'unlisted', 'private', 'direct'],
      supportsIdempotencyKey: true,
      auth: {
        kind: 'oauth2',
        scopes: ['write:statuses', 'write:media'],
        docsUrl: 'https://docs.pixelfed.org/technical-documentation/api/',
      },
      sources: source('https://docs.pixelfed.org/technical-documentation/api/', [
        'Mastodon-compatible API',
      ]),
    },
    'Implemented as a descriptor over the Mastodon API adapter; instance limits are discovered at runtime.',
  ),
  truthSocial: profile(
    'truthSocial',
    'Truth Social',
    'restricted',
    {
      postTypes: {
        [PostType.POST]: { requiredFields: ['body'] },
        [PostType.IMAGE]: { requiredFields: ['media'], minMediaCount: 1, maxMediaCount: 4 },
        [PostType.VIDEO]: { requiredFields: ['media'], minMediaCount: 1, maxMediaCount: 1 },
      },
      media: pushMedia(['image', 'video']),
      supportsContentWarning: true,
      supportsReply: true,
      sensitive: { supportedValues: [false, true] },
      supportedVisibility: ['public', 'unlisted', 'private', 'direct'],
      supportsIdempotencyKey: true,
      auth: { kind: 'oauth2', scopes: ['write:statuses', 'write:media'] },
      sources: source('https://truthsocial.com/terms-of-service', ['service terms']),
    },
    'No adapter is exported until lawful API access and permission for automated publishing are documented.',
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
    media: pushMedia(['image', 'video']),
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
    media: pushMedia(['image', 'video']),
    supportsReply: true,
    supportsRepost: true,
    supportsQuote: true,
    auth: { kind: 'custom', docsUrl: 'https://docs.bsky.app/docs/advanced-guides/posts' },
    sources: source('https://docs.bsky.app/docs/advanced-guides/posts', [
      'post records and embeds',
    ]),
  }),
  snapchat: profile(
    'snapchat',
    'Snapchat',
    'restricted',
    {
      postTypes: {
        [PostType.STORY]: { requiredFields: ['media'], minMediaCount: 1, maxMediaCount: 1 },
      },
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
    media: pushMedia(['image', 'video', 'audio', 'document']),
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
    media: {
      image: { acceptedSources: ['url', 'bytes', 'blob'], transport: 'both' },
      video: { acceptedSources: directUploadSources.slice(), transport: 'push' },
    },
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
      media: pushMedia(['image', 'video', 'document']),
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
      media: pushMedia(['video']),
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
      media: pushMedia(['video']),
      auth: { kind: 'oauth2', docsUrl: 'https://developers.kwai.com/' },
      sources: source('https://developers.kwai.com/', ['developer program']),
    },
    'Publishing documentation and access are region- and partner-program dependent.',
  ),
  dailymotion: profile(
    'dailymotion',
    'Dailymotion',
    'available',
    {
      postTypes: {
        [PostType.VIDEO]: {
          requiredFields: ['media', 'title'],
          minMediaCount: 1,
          maxMediaCount: 1,
        },
      },
      media: pushMedia(['video']),
      auth: { kind: 'oauth2', docsUrl: 'https://developers.dailymotion.com/guides/upload-videos/' },
      sources: source('https://developers.dailymotion.com/guides/upload-videos/', [
        'video upload flow',
      ]),
    },
    'A released adapter ships the authoritative descriptor for this network; prefer `@bozonx/social-posting-dailymotion` over this profile, which stays for hosts that only need to plan against the network without depending on the adapter.',
  ),
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

/**
 * Media a network takes as an upload from us.
 *
 * There is no "generic" media block any more: a descriptor either states a
 * transport backed by the cited source, or states no media at all. A guessed
 * value reads exactly like a verified one at the call site, which is how a
 * catalogue stops being useful.
 */
function pushMedia(kinds: MediaKindName[], acceptedSources = directUploadSources.slice()) {
  return Object.fromEntries(
    kinds.map(kind => [kind, { acceptedSources: [...acceptedSources], transport: 'push' }]),
  ) as Partial<Record<MediaKindName, MediaConstraints>>;
}

/** Media the network fetches itself from a URL we hand it. */
function pullMedia(kinds: MediaKindName[]) {
  return Object.fromEntries(
    kinds.map(kind => [
      kind,
      {
        acceptedSources: ['url'],
        transport: 'pull',
        requiresPubliclyFetchableUrl: true,
      },
    ]),
  ) as Partial<Record<MediaKindName, MediaConstraints>>;
}
