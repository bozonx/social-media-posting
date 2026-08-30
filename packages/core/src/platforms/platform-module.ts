import type { ILogger } from '../logger/logger.js';
import type { IAuthValidator } from './auth-validator.interface.js';
import type { IPlatform } from './platform.interface.js';
import type { PlatformCapabilities } from './capabilities.js';
import type { CredentialProvider } from '../auth/credentials.js';
import { ValidationError } from '../errors/posting-error.js';

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
  /** Custom fetch implementation for tests, proxies or regional endpoints. */
  fetch?: typeof fetch;
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
  /**
   * The API family this network speaks (`'mastodon-api'`, `'atproto'`).
   *
   * Metadata, not behaviour: the registry keys on `name`. It documents why one
   * package can serve several networks and lets conformance pick the shared
   * fixtures for a family.
   */
  dialect?: string;
  /** What this platform accepts, as data. */
  capabilities: PlatformCapabilities;
  /** Build a platform instance bound to the given collaborators. */
  create(deps: PlatformDeps): IPlatform;
  /** Validator for this platform's credential shape, when it has one. */
  authValidator?: IAuthValidator;
}

/**
 * Build a sibling module from an existing one.
 *
 * Pixelfed speaks the Mastodon API; Bluesky and every other ATProto PDS speak
 * one protocol. Without this, the second network in a family is a copy of the
 * first with two strings changed — and the copy stops being a copy on the first
 * bug fix.
 *
 * @param base - The module to derive from.
 * @param overrides - The new name, its descriptor, and optionally a dialect.
 * @returns A module sharing `base`'s implementation under a new name.
 */
export function deriveModule(
  base: PlatformModule,
  overrides: {
    name: string;
    capabilities: PlatformCapabilities;
    dialect?: string;
    authValidator?: IAuthValidator;
  },
): PlatformModule {
  if (overrides.capabilities.name !== overrides.name) {
    throw new ValidationError(
      `Derived module "${overrides.name}" must carry a descriptor of the same name, got "${overrides.capabilities.name}"`,
    );
  }

  return {
    name: overrides.name,
    dialect: overrides.dialect ?? base.dialect,
    capabilities: overrides.capabilities,
    authValidator: overrides.authValidator ?? base.authValidator,
    create(deps: PlatformDeps): IPlatform {
      const instance = base.create(deps);
      // The instance answers as the derived network, with the derived rules,
      // while every method stays the base implementation.
      return new Proxy(instance, {
        get(target, property, receiver) {
          if (property === 'name') {
            return overrides.name;
          }
          if (property === 'capabilities') {
            return overrides.capabilities;
          }
          const value = Reflect.get(target, property, receiver) as unknown;
          return typeof value === 'function'
            ? (value as (...args: unknown[]) => unknown).bind(receiver)
            : value;
        },
      });
    },
  };
}
