import type { ILogger } from '../logger/logger.js';
import type { IAuthValidator } from './auth-validator.interface.js';
import type { IPlatform } from './platform.interface.js';
import type { PlatformCapabilities } from './capabilities.js';
import type { CredentialProvider } from '../auth/credentials.js';

/**
 * What the client hands a platform when it builds one.
 *
 * Passing collaborators here rather than letting a platform reach for them is
 * what keeps two clients in one process independent.
 */
export interface PlatformDeps {
  /** Logger this platform instance writes to. */
  logger: ILogger;
  /** Host-owned credential store, available to OAuth-capable platforms. */
  credentialProvider?: CredentialProvider;
}

/**
 * The single object a platform package exports.
 *
 * A host registers networks by listing their modules; it never has to know how
 * a given platform is constructed, and capabilities can be read without
 * building one.
 *
 * ```ts
 * export const telegram: PlatformModule = {
 *   name: 'telegram',
 *   capabilities: telegramCapabilities,
 *   create: deps => new TelegramPlatform(deps),
 *   authValidator: new TelegramAuthValidator(),
 * };
 * ```
 */
export interface PlatformModule {
  /** Platform name, matching the `platform` field of a request. */
  name: string;
  /** What this platform accepts, as data. */
  capabilities: PlatformCapabilities;
  /** Build a platform instance bound to the given collaborators. */
  create(deps: PlatformDeps): IPlatform;
  /** Validator for this platform's credential shape, when it has one. */
  authValidator?: IAuthValidator;
}
