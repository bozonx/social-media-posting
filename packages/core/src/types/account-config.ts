import type { ResolvedCredentials } from '../auth/credentials.js';

/**
 * Account configuration.
 * A named set of credentials plus per-account defaults for one platform.
 */
export interface AccountConfig {
  /** Platform name (e.g. 'telegram'). */
  platform: string;

  /**
   * Authentication credentials.
   *
   * Not narrowed to strings: OAuth2 accounts carry an expiry timestamp and a
   * scope list alongside the tokens.
   */
  auth: ResolvedCredentials;

  /** Platform-specific target identifier (channel, page, board, community, profile). */
  target?: string | number;

  /** Maximum body length for this account (characters). */
  maxBodyLength?: number;

  /** Additional platform-specific settings. */
  [key: string]: unknown;
}

/**
 * Account configuration as the platform receives it, with the origin of the
 * credentials recorded so services can log which path was taken.
 */
export interface ResolvedAccountConfig extends AccountConfig {
  /** Where the credentials came from: a named account or inline request auth. */
  source: 'account' | 'inline';
}
