import type { AccountConfig } from '../types/account-config.js';

/** Lowest and highest accepted request timeout, in seconds. */
const MIN_REQUEST_TIMEOUT_SECS = 1;
const MAX_REQUEST_TIMEOUT_SECS = 600;
const DEFAULT_REQUEST_TIMEOUT_SECS = 60;

const MAX_RETRY_ATTEMPTS = 10;
const DEFAULT_RETRY_ATTEMPTS = 3;
const MAX_RETRY_DELAY_MS = 60_000;
const DEFAULT_RETRY_DELAY_MS = 1000;

const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;

/** Log level accepted by the built-in console logger. */
export type LogLevel = (typeof LOG_LEVELS)[number];

/**
 * Tuning knobs shared by every posting client, independent of which platforms
 * are registered.
 */
export interface PostingConfigInput {
  /** Named account configurations. */
  accounts: Record<string, AccountConfig>;
  /** Overall timeout for one publish call, in seconds (default: 60). */
  requestTimeoutSecs?: number;
  /** Number of attempts per publish call (default: 3). */
  retryAttempts?: number;
  /** Base delay between attempts, in milliseconds (default: 1000). */
  retryDelayMs?: number;
  /** Log level for the built-in console logger (default: 'warn'). */
  logLevel?: LogLevel;
}

function requireInteger(
  value: unknown,
  field: string,
  min: number,
  max: number,
  fallback: number,
  errors: string[],
): number {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    errors.push(`${field} must be an integer between ${min} and ${max}`);
    return fallback;
  }
  return value;
}

/**
 * Validated configuration of a posting client.
 *
 * Validation happens once, in the constructor: an invalid configuration fails
 * at client creation rather than on the first publish.
 */
export class PostingConfig {
  readonly accounts: Record<string, AccountConfig>;
  readonly requestTimeoutSecs: number;
  readonly retryAttempts: number;
  readonly retryDelayMs: number;
  readonly logLevel: LogLevel;

  constructor(input: PostingConfigInput) {
    const errors: string[] = [];

    if (typeof input !== 'object' || input === null) {
      throw new Error('Posting config validation error: config must be an object');
    }

    const accounts = input.accounts;
    if (typeof accounts !== 'object' || accounts === null || Array.isArray(accounts)) {
      errors.push('accounts must be an object keyed by account name');
    } else {
      for (const [name, account] of Object.entries(accounts)) {
        errors.push(...validateAccount(name, account));
      }
    }

    this.accounts = (accounts ?? {}) as Record<string, AccountConfig>;
    this.requestTimeoutSecs = requireInteger(
      input.requestTimeoutSecs,
      'requestTimeoutSecs',
      MIN_REQUEST_TIMEOUT_SECS,
      MAX_REQUEST_TIMEOUT_SECS,
      DEFAULT_REQUEST_TIMEOUT_SECS,
      errors,
    );
    this.retryAttempts = requireInteger(
      input.retryAttempts,
      'retryAttempts',
      0,
      MAX_RETRY_ATTEMPTS,
      DEFAULT_RETRY_ATTEMPTS,
      errors,
    );
    this.retryDelayMs = requireInteger(
      input.retryDelayMs,
      'retryDelayMs',
      0,
      MAX_RETRY_DELAY_MS,
      DEFAULT_RETRY_DELAY_MS,
      errors,
    );

    const logLevel = input.logLevel ?? 'warn';
    if (!LOG_LEVELS.includes(logLevel)) {
      errors.push(`logLevel must be one of ${LOG_LEVELS.join(', ')}`);
    }
    this.logLevel = LOG_LEVELS.includes(logLevel) ? logLevel : 'warn';

    if (errors.length > 0) {
      throw new Error(`Posting config validation error: ${errors.join('; ')}`);
    }
  }

  /**
   * Look up a named account.
   * @param accountName - Name of the account as it appears in `accounts`.
   * @throws Error if no such account is configured.
   */
  getAccount(accountName: string): AccountConfig {
    const account = this.accounts[accountName];
    if (!account) {
      throw new Error(`Account "${accountName}" not found in configuration`);
    }
    return account;
  }

  /** All configured accounts, keyed by name. */
  getAllAccounts(): Record<string, AccountConfig> {
    return this.accounts;
  }
}

function validateAccount(name: string, account: unknown): string[] {
  const errors: string[] = [];
  const prefix = `account "${name}"`;

  if (typeof account !== 'object' || account === null || Array.isArray(account)) {
    return [`${prefix}: must be an object`];
  }

  const { platform, auth, channelId, maxBody } = account as Partial<AccountConfig>;

  if (typeof platform !== 'string' || platform.trim().length === 0) {
    errors.push(`${prefix}: platform must be a non-empty string`);
  }
  if (auth !== undefined && (typeof auth !== 'object' || auth === null || Array.isArray(auth))) {
    errors.push(`${prefix}: auth must be an object`);
  }
  if (channelId !== undefined && typeof channelId !== 'string' && typeof channelId !== 'number') {
    errors.push(`${prefix}: channelId must be a string or a number`);
  }
  if (
    maxBody !== undefined &&
    (typeof maxBody !== 'number' || !Number.isInteger(maxBody) || maxBody < 1)
  ) {
    errors.push(`${prefix}: maxBody must be a positive integer`);
  }

  return errors;
}
