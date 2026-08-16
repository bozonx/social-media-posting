import type { PostRequest } from '../types/post-request.js';
import { PostType } from '../types/post-type.js';
import { MediaInputHelper } from './media-input.helper.js';

/**
 * Detect the primary media field of a request by fixed priority:
 * 1. `media[]` → album
 * 2. `document` → document
 * 3. `audio` → audio
 * 4. `video` → video
 *
 * @param request - The post request.
 * @returns The implied post type, or null when the request carries no primary media.
 */
export function detectPrimaryMediaField(request: PostRequest): PostType | null {
  if (MediaInputHelper.isNotEmpty(request.media)) {
    return PostType.ALBUM;
  }
  if (MediaInputHelper.isDefined(request.document)) {
    return PostType.DOCUMENT;
  }
  if (MediaInputHelper.isDefined(request.audio)) {
    return PostType.AUDIO;
  }
  if (MediaInputHelper.isDefined(request.video)) {
    return PostType.VIDEO;
  }
  return null;
}
