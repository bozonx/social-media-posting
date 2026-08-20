import type { AuthValidation, IAuthValidator } from '@bozonx/social-posting/platform';

/**
 * Validates the shape of Telegram credentials: a bot token must be present and
 * look like one.
 */
export class TelegramAuthValidator implements IAuthValidator {
  readonly providerName = 'telegram';

  /**
   * Validate a Telegram credential object.
   *
   * A bot token is static: it never expires, so this check is purely about
   * shape and never reports `AUTH_REFRESH_REQUIRED`.
   *
   * @param auth - Credentials, expected to carry `apiKey`.
   * @returns The problems found; an empty list means the token is well-formed.
   */
  validate(auth: Record<string, unknown>): AuthValidation {
    const errors: string[] = [];

    const apiKey = auth.apiKey;
    if (!apiKey) {
      errors.push("Field 'apiKey' is required for Telegram auth");
    } else if (typeof apiKey !== 'string') {
      errors.push("Field 'apiKey' must be a string");
    } else if (!isValidBotToken(apiKey)) {
      errors.push("Field 'apiKey' has invalid format (expected: 123456789:ABC-DEF...)");
    }

    return { errors };
  }
}

/**
 * Telegram bot tokens look like `123456789:ABC-DEF1234ghIkl-zyx57W2v1u123ew11`.
 */
function isValidBotToken(token: string): boolean {
  return /^\d+:[A-Za-z0-9_-]+$/.test(token);
}
