import type { PostRequest } from '../types/post-request.js';
import { PostType } from '../types/post-type.js';
import type { MediaInput, MediaType } from '../types/media-input.js';
import { MediaInputHelper } from './media-input.helper.js';

/**
 * Detect the specific media kind ('image', 'video', 'audio', 'document') of a single MediaInput.
 */
export function detectItemMediaKind(item: MediaInput, contextType?: PostType): MediaType {
  if (item.type) {
    return item.type;
  }
  if (item.mimeType) {
    if (item.mimeType.startsWith('video/')) return 'video';
    if (item.mimeType.startsWith('audio/')) return 'audio';
    if (item.mimeType.startsWith('image/')) return 'image';
    return 'document';
  }
  const candidate =
    item.source.kind === 'url'
      ? item.source.url
      : item.source.kind === 'platformRef'
        ? item.source.ref
        : (item.fileName ?? '');
  if (/\.(mp4|mov|avi|mkv|webm)$/i.test(candidate)) return 'video';
  if (/\.(mp3|wav|ogg|flac|m4a|aac)$/i.test(candidate)) return 'audio';
  if (/\.(pdf|doc|docx|zip|tar|gz|txt)$/i.test(candidate)) return 'document';
  if (/\.(jpe?g|png|gif|webp|bmp|svg|heic)$/i.test(candidate)) return 'image';

  if (contextType === PostType.VIDEO) return 'video';
  if (contextType === PostType.AUDIO) return 'audio';
  if (contextType === PostType.DOCUMENT) return 'document';
  if (contextType === PostType.IMAGE) return 'image';

  return 'image';
}

/**
 * Detect the primary media post type of a request from its `media[]` items:
 * - `media.length > 1` → ALBUM
 * - `media.length === 1` → IMAGE, VIDEO, AUDIO, or DOCUMENT (based on type/extension)
 *
 * @param request - The post request.
 * @returns The implied post type, or null when the request carries no publishable media.
 */
export function detectPrimaryMediaField(request: PostRequest): PostType | null {
  if (!MediaInputHelper.isNotEmpty(request.media)) {
    return null;
  }
  const media = request.media;
  if (media.length > 1) {
    return PostType.ALBUM;
  }
  const single = media[0];

  const kind = detectItemMediaKind(single);
  switch (kind) {
    case 'video':
      return PostType.VIDEO;
    case 'audio':
      return PostType.AUDIO;
    case 'document':
      return PostType.DOCUMENT;
    case 'image':
    default:
      return PostType.IMAGE;
  }
}
