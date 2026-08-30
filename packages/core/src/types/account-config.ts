import type { ResolvedCredentials } from '../auth/credentials.js';
import type { PlatformTarget, TargetInput } from './target.js';

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

  /** Default target (channel, page, board, community, profile) for this account. */
  target?: TargetInput;

  /**
   * Base URL of the API this account talks to.
   *
   * A property of the account, not of the package: Mastodon, Pixelfed and
   * ATProto accounts each live on their own host. Networks with one host leave
   * it unset and the adapter supplies its default. Must be an absolute
   * `https:` URL when present.
   */
  apiBaseUrl?: string;

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
  /**
   * The account name the request used, when it named one.
   *
   * An OAuth2 adapter needs it: refreshing a token means handing the rotated
   * pair back to the host's provider, and the provider addresses accounts by
   * this name. Absent for inline credentials, which is exactly the case where
   * a rotated token has nowhere to be stored.
   */
  accountRef?: string;
  /** Always normalized: an adapter never sees the scalar shorthand. */
  target?: PlatformTarget;
}
