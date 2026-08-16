import type { IAuthValidator } from '@bozonx/social-posting';

/**
 * Validates the shape of Telegram credentials: a bot token must be present and
 * look like one.
 */
export class TelegramAuthValidator implements IAuthValidator {
  readonly providerName = 'telegram';

  /**
   * Validate a Telegram credential object.
   * @param auth - Credentials, expected to carry `apiKey`.
   * @returns Error messages; empty when the credentials are well-formed.
   */
  validate(auth: Record<string, unknown>): string[] {
    const errors: string[] = [];

    if (!auth) {
      errors.push('Auth object is required for Telegram');
      return errors;
    }

    if (!auth.apiKey) {
      errors.push("Field 'apiKey' is required for Telegram auth");
    } else if (typeof auth.apiKey !== 'string') {
      errors.push("Field 'apiKey' must be a string");
    } else if (!isValidBotToken(auth.apiKey)) {
      errors.push("Field 'apiKey' has invalid format (expected: 123456789:ABC-DEF...)");
    }

    return errors;
  }
}

/**
 * Telegram bot tokens look like `123456789:ABC-DEF1234ghIkl-zyx57W2v1u123ew11`.
 */
function isValidBotToken(token: string): boolean {
  return /^\d+:[A-Za-z0-9_-]+$/.test(token);
}
