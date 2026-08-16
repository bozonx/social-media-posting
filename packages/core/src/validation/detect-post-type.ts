import { PostType } from '../types/post-type.js';
import { MediaInputHelper } from '../media/media-input.helper.js';
import { detectPrimaryMediaField } from '../media/media-priority.js';
import type { PostRequest } from '../types/post-request.js';

/**
 * Work out which post type a request means, from the media it carries.
 *
 * Priority: an explicit `type` wins; then `media[]` → album, `document`,
 * `audio`, `video`, `cover` → image; a request with no media is a plain post.
 *
 * Platforms whose type system differs override this through
 * {@link IPlatform.detectType}; most do not need to.
 *
 * @param request - The post request.
 * @returns The post type to publish as.
 */
export function detectPostType(request: PostRequest): PostType {
  if (request.type && request.type !== PostType.AUTO) {
    return request.type;
  }

  const primaryType = detectPrimaryMediaField(request);
  if (primaryType) {
    return primaryType;
  }

  if (MediaInputHelper.isDefined(request.cover)) {
    return PostType.IMAGE;
  }

  return PostType.POST;
}
