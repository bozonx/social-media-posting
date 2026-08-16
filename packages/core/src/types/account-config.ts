/**
 * Account configuration.
 * A named set of credentials plus per-account defaults for one platform.
 */
export interface AccountConfig {
  /** Platform name (e.g. 'telegram'). */
  platform: string;

  /** Authentication credentials. */
  auth: Record<string, string>;

  /** Platform-specific channel/chat identifier. */
  channelId?: string | number;

  /** Maximum body length for this account (characters). */
  maxBody?: number;

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
