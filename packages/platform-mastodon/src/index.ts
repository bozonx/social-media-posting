import { deriveModule, type PlatformModule } from '@bozonx/social-posting';
import { MastodonAuthValidator } from './mastodon-auth.validator.js';
import { MastodonPlatform } from './mastodon.platform.js';
import { mastodonCapabilities, pixelfedCapabilities } from './capabilities.js';

const authValidator = new MastodonAuthValidator();
export const mastodon: PlatformModule = {
  name: 'mastodon',
  dialect: 'mastodon-api',
  capabilities: mastodonCapabilities,
  create: deps => new MastodonPlatform(deps),
  authValidator,
};
export const pixelfed = deriveModule(mastodon, {
  name: 'pixelfed',
  capabilities: pixelfedCapabilities,
  authValidator: new MastodonAuthValidator('pixelfed'),
});
export { MastodonPlatform } from './mastodon.platform.js';
export type { MastodonAccountConfig, MastodonPlatformDeps } from './mastodon.platform.js';
export { MastodonAuthValidator, REQUIRED_SCOPES } from './mastodon-auth.validator.js';
export { mastodonCapabilities, pixelfedCapabilities } from './capabilities.js';
