import { MediaInputHelper, ValidationError } from '@bozonx/social-posting';
import type { MediaInput } from '@bozonx/social-posting';

/**
 * Convert a media input into the value the Bot API accepts: either an
 * already-uploaded `file_id` or a public URL Telegram fetches itself.
 * @param input - Media input to convert.
 * @throws ValidationError if the input carries neither.
 */
export function toTelegramInput(input: MediaInput): string {
  const platformRef = MediaInputHelper.getPlatformRef(input);
  if (platformRef) {
    return platformRef;
  }

  const url = MediaInputHelper.getUrl(input);
  if (url) {
    return url;
  }

  throw new ValidationError('MediaInput must be an object with a src property');
}
