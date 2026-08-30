/**
 * `@bozonx/social-posting-discord` — Discord support for `@bozonx/social-posting`.
 *
 * Register it by passing {@link discord} to `createPostingClient`.
 */
import type { PlatformModule } from '@bozonx/social-posting';
import { DiscordPlatform } from './discord.platform.js';
import { DiscordAuthValidator } from './discord-auth.validator.js';
import { discordCapabilities } from './capabilities.js';

/** The descriptor a host registers to publish to Discord. */
export const discord: PlatformModule = {
  name: 'discord',
  capabilities: discordCapabilities,
  create: deps => new DiscordPlatform(deps),
  authValidator: new DiscordAuthValidator(),
};

export { DiscordPlatform } from './discord.platform.js';
export type {
  DiscordAccountConfig,
  DiscordExtra,
  DiscordPlatformDeps,
} from './discord.platform.js';
export {
  DiscordAuthValidator,
  validateDiscordAuth,
  parseWebhookUrl,
  authModeOf,
} from './discord-auth.validator.js';
export type { DiscordAuthMode, DiscordWebhookParts } from './discord-auth.validator.js';
export { DiscordApi, API_VERSION, DEFAULT_API_BASE_URL } from './discord-api.js';
export type { DiscordMessage } from './discord-api.js';
export { toPlatformError } from './discord-error.js';
export {
  discordCapabilities,
  MAX_MESSAGE_LENGTH,
  MAX_ATTACHMENTS,
  MAX_ALT_TEXT_LENGTH,
  DEFAULT_MAX_ATTACHMENT_BYTES,
  ATTACHMENT_BYTES_BY_BOOST_TIER,
} from './capabilities.js';
