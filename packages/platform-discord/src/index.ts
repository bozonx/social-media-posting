/**
 * `@bozonx/social-posting-discord` — Discord support for `@bozonx/social-posting`.
 */
import type { PlatformModule } from '@bozonx/social-posting';
import { DiscordPlatform } from './discord.platform.js';
import { DiscordAuthValidator } from './discord-auth.validator.js';
import { discordCapabilities } from './capabilities.js';

/** The descriptor a host registers to publish to Discord. */
export const discord: PlatformModule = {
  name: 'discord',
  // The API family this network speaks, when it shares one ('mastodon-api',
  // 'atproto'). Metadata only — see deriveModule() for serving a family.
  // dialect: undefined,
  capabilities: discordCapabilities,
  create: deps => new DiscordPlatform(deps),
  authValidator: new DiscordAuthValidator(),
};

export { DiscordPlatform } from './discord.platform.js';
export { DiscordAuthValidator } from './discord-auth.validator.js';
export { discordCapabilities } from './capabilities.js';
