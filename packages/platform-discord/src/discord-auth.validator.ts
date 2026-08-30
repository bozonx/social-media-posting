import type { AuthValidation, IAuthValidator } from '@bozonx/social-posting/platform';

/** Where a webhook URL lives, and the two ids inside it. */
const WEBHOOK_URL_PATTERN =
  /^https:\/\/(?:[a-z0-9-]+\.)?discord(?:app)?\.com\/api(?:\/v\d+)?\/webhooks\/(\d{5,25})\/([\w-]{20,})$/i;

/** What a bot token looks like: three dot-separated base64url segments. */
const BOT_TOKEN_PATTERN = /^[\w-]{20,}\.[\w-]{5,}\.[\w-]{20,}$/;

/** The two ways an account may address Discord. */
export type DiscordAuthMode = 'webhook' | 'bot';

/** A webhook URL split into the parts every webhook call needs. */
export interface DiscordWebhookParts {
  id: string;
  token: string;
}

/**
 * Validates the shape of Discord credentials.
 *
 * Discord is the one network in the set where the credential and the
 * destination can be the same string: a webhook URL has the guild and channel
 * baked into it. That is why this validator reports which of the two models an
 * account uses — the rest of the adapter branches on the answer, and a host
 * storing a webhook URL must treat it as a secret, not as a channel id.
 */
export class DiscordAuthValidator implements IAuthValidator {
  readonly providerName = 'discord';

  validate(auth: Record<string, unknown>): AuthValidation {
    return validateDiscordAuth(auth);
  }
}

/** Validate Discord auth without constructing an adapter or performing I/O. */
export function validateDiscordAuth(auth: Record<string, unknown>): AuthValidation {
  const errors: string[] = [];
  const { webhookUrl, botToken } = auth as { webhookUrl?: unknown; botToken?: unknown };

  const hasWebhook = webhookUrl !== undefined && webhookUrl !== null && webhookUrl !== '';
  const hasBot = botToken !== undefined && botToken !== null && botToken !== '';

  if (!hasWebhook && !hasBot) {
    errors.push("Discord auth requires either 'webhookUrl' or 'botToken'");
    return { errors };
  }

  if (hasWebhook && hasBot) {
    // Not a convenience: the two models produce different messages, different
    // permalinks and different delete calls. Guessing between them is worse
    // than refusing.
    errors.push(
      "Discord auth must carry exactly one of 'webhookUrl' or 'botToken', not both — they are different access models",
    );
    return { errors };
  }

  if (hasWebhook) {
    if (typeof webhookUrl !== 'string') {
      errors.push("Field 'webhookUrl' must be a string");
    } else if (!parseWebhookUrl(webhookUrl)) {
      errors.push(
        "Field 'webhookUrl' has invalid format (expected: https://discord.com/api/webhooks/<id>/<token>)",
      );
    }
    return { errors };
  }

  if (typeof botToken !== 'string') {
    errors.push("Field 'botToken' must be a string");
  } else if (!BOT_TOKEN_PATTERN.test(botToken)) {
    errors.push("Field 'botToken' has invalid format");
  }

  return { errors };
}

/**
 * Split a webhook URL into its id and token.
 * @param url - The webhook URL from the account credentials.
 * @returns The parts, or undefined when the URL is not a webhook URL.
 */
export function parseWebhookUrl(url: string): DiscordWebhookParts | undefined {
  const match = WEBHOOK_URL_PATTERN.exec(url.trim());
  if (!match) {
    return undefined;
  }
  return { id: match[1] as string, token: match[2] as string };
}

/** Which access model an account's credentials select. */
export function authModeOf(auth: Record<string, unknown>): DiscordAuthMode | undefined {
  if (typeof auth.webhookUrl === 'string' && auth.webhookUrl.length > 0) {
    return 'webhook';
  }
  if (typeof auth.botToken === 'string' && auth.botToken.length > 0) {
    return 'bot';
  }
  return undefined;
}
