/**
 * `@bozonx/social-posting-telegram` — Telegram Bot API support for
 * `@bozonx/social-posting`.
 *
 * Register it by passing {@link telegram} to `createPostingClient`.
 */
import type { PlatformModule } from '@bozonx/social-posting';
import { TelegramPlatform } from './telegram.platform.js';
import { TelegramAuthValidator } from './telegram-auth.validator.js';
import { telegramCapabilities } from './capabilities.js';

/** The descriptor a host registers to publish to Telegram. */
export const telegram: PlatformModule = {
  name: 'telegram',
  capabilities: telegramCapabilities,
  create: deps => new TelegramPlatform(deps),
  authValidator: new TelegramAuthValidator(),
};

export { TelegramPlatform } from './telegram.platform.js';
export type { TelegramAccountConfig, TelegramPlatformDeps } from './telegram.platform.js';
export { TelegramAuthValidator } from './telegram-auth.validator.js';
export { telegramCapabilities, MAX_MEDIA_GROUP_SIZE, MAX_CAPTION_LENGTH } from './capabilities.js';
