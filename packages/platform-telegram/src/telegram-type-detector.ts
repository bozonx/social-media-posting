import { MediaInputHelper, PostType, detectPrimaryMediaField } from '@bozonx/social-posting';
import type { PostRequest } from '@bozonx/social-posting';

/**
 * Decide which Telegram message type a request maps to.
 *
 * Priority: `media[]` → album, `document`, `audio`, `video`, `cover` → image,
 * nothing → plain post.
 */
export class TelegramTypeDetector {
  /**
   * Detect the message type for a request.
   * @param request - Post request.
   * @returns The explicit type when one was given, otherwise the detected one.
   */
  detectType(request: PostRequest): PostType {
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
}
