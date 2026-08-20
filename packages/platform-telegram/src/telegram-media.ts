import { ValidationError } from '@bozonx/social-posting';
import type { MediaInput } from '@bozonx/social-posting';

/**
 * Convert a media input into the value the Bot API accepts: either an
 * already-uploaded `file_id` or a public URL Telegram fetches itself.
 * @param input - Media input to convert.
 * @throws ValidationError if the input carries neither.
 */
export function toTelegramInput(input: MediaInput): string {
  const source = (input as { source?: MediaInput['source'] }).source;
  if (!source) {
    throw new ValidationError('MediaInput must carry a valid source');
  }

  if (input.source.kind === 'platformRef') {
    return input.source.ref.trim();
  }

  if (input.source.kind === 'url') {
    const trimmed = input.source.url.trim();
    if (trimmed.includes('\n') || trimmed.includes('\r')) {
      throw new ValidationError('Invalid media URL format');
    }
    return trimmed;
  }

  throw new ValidationError(
    `Telegram media must be a URL or platform file_id, got kind: ${input.source.kind}`,
  );
}
