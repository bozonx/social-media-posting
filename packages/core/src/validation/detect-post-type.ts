import { PostType } from '../types/post-type.js';
import { detectPrimaryMediaField } from '../media/media-priority.js';
import type { PostRequest } from '../types/post-request.js';

/**
 * Work out which post type a request means, from the content and media it carries.
 *
 * Priority: an explicit `type` wins; then `poll` → poll; then `media[]` → album/single-media;
 * `repostOf` or plain content → post.
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

  if (request.poll) {
    return PostType.POLL;
  }

  const primaryType = detectPrimaryMediaField(request);
  if (primaryType) {
    return primaryType;
  }

  return PostType.POST;
}
