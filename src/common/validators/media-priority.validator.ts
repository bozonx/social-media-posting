import { type PostRequestDto } from '../../modules/post/dto/post-request.dto.js';
import { PostType } from '../enums/index.js';
import { MediaInputHelper } from '../helpers/media-input.helper.js';

/**
 * Validator and detector for media fields based on strict priority
 * Implements soft comparison where higher priority fields take precedence
 */
export class MediaPriorityValidator {
  /**
   * Detects the primary media field based on priority:
   * 1. media[] -> ALBUM
   * 2. document -> DOCUMENT
   * 3. audio -> AUDIO
   * 4. video -> VIDEO
   *
   * @param request The post request
   * @returns The detected PostType or null if no primary media found
   */
  static detectPrimaryMediaField(request: PostRequestDto): PostType | null {
    // Priority 1: media[] -> ALBUM
    if (MediaInputHelper.isNotEmpty(request.media)) {
      return PostType.ALBUM;
    }

    // Priority 2: document -> DOCUMENT
    if (MediaInputHelper.isDefined(request.document)) {
      return PostType.DOCUMENT;
    }

    // Priority 3: audio -> AUDIO
    if (MediaInputHelper.isDefined(request.audio)) {
      return PostType.AUDIO;
    }

    // Priority 4: video -> VIDEO
    if (MediaInputHelper.isDefined(request.video)) {
      return PostType.VIDEO;
    }

    return null;
  }
}
