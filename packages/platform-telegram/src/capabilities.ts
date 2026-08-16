import { PostType } from '@bozonx/social-posting';
import type { PlatformCapabilities } from '@bozonx/social-posting';

/** Largest number of items the Bot API accepts in one media group. */
export const MAX_MEDIA_GROUP_SIZE = 10;

/**
 * What Telegram accepts, stated as data.
 *
 * Numbers come from the Bot API documentation; where Telegram documents no
 * limit, the field is simply absent rather than guessed at.
 */
export const telegramCapabilities: PlatformCapabilities = {
  name: 'telegram',

  supportedTypes: [
    PostType.AUTO,
    PostType.POST,
    PostType.IMAGE,
    PostType.VIDEO,
    PostType.ALBUM,
    PostType.AUDIO,
    PostType.DOCUMENT,
  ],

  postTypes: {
    [PostType.POST]: {
      requiredFields: ['body'],
      forbiddenFields: ['cover', 'video', 'audio', 'document', 'media'],
    },
    [PostType.IMAGE]: { requiredFields: ['cover'] },
    [PostType.VIDEO]: { requiredFields: ['video'] },
    [PostType.AUDIO]: { requiredFields: ['audio'] },
    [PostType.DOCUMENT]: { requiredFields: ['document'] },
    [PostType.ALBUM]: {
      requiredFields: ['media'],
      minMediaCount: 1,
      maxMediaCount: MAX_MEDIA_GROUP_SIZE,
    },
  },

  // A message body may run to 4096 characters; a media caption to 1024. The
  // stricter of the two is the safe generic limit, and the platform hook
  // refines it per type.
  maxBodyLength: 4096,

  supportedBodyFormats: ['text', 'html', 'md', 'MarkdownV2'],
  targetBodyFormat: 'text',

  // Telegram downloads media from a public URL itself, so bytes never have to
  // pass through this process. That is what makes a Workers deployment viable.
  supportsUrlPassthrough: true,
  requiresByteUpload: false,

  supportsNativeScheduling: false,
  supportsDraft: false,
  supportsSpoiler: true,
  supportsCoverWithMedia: false,
  supportsTags: false,
};

/** Largest caption Telegram accepts on a media message. */
export const MAX_CAPTION_LENGTH = 1024;
