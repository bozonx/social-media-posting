import type { AccountConfig } from '../types/account-config.js';
import { isValidTargetInput } from '../types/target.js';

/** Whether a value is an absolute `https:` URL, as `apiBaseUrl` must be. */
export function isAbsoluteHttpsUrl(value: unknown): boolean {
  if (typeof value !== 'string') {
    return false;
  }
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

/** Lowest and highest accepted request timeout, in seconds. */
const MIN_REQUEST_TIMEOUT_SECS = 1;
const MAX_REQUEST_TIMEOUT_SECS = 600;
const DEFAULT_REQUEST_TIMEOUT_SECS = 60;

const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;

/** Log level accepted by the built-in console logger. */
export type LogLevel = (typeof LOG_LEVELS)[number];

/**
 * Tuning knobs shared by every posting client, independent of which platforms
 * are registered.
 *
 * There is deliberately no retry setting: one publish call makes one attempt.
 * Retrying is the host's job, and every error says whether and when to.
 */
export interface PostingConfigInput {
  /** Named account configurations. */
  accounts: Record<string, AccountConfig>;
  /** Overall timeout for one publish call, in seconds (default: 60). */
  requestTimeoutSecs?: number;
  /** Log level for the built-in console logger (default: 'warn'). */
  logLevel?: LogLevel;
  /**
   * Throw when a platform puts a secret in a resume handle, instead of
   * stripping it and warning (default: false).
   *
   * Turn it on in development and in tests: an adapter that leaks a token into
   * a handle the host persists should fail loudly there, and quietly in
   * production rather than taking a publication down with it.
   */
  strictResumeHandles?: boolean;
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
  readonly logLevel: LogLevel;
  readonly strictResumeHandles: boolean;

  constructor(input: PostingConfigInput) {
    const errors: string[] = [];

    const rawInput = input as unknown;
    if (typeof rawInput !== 'object' || rawInput === null) {
      throw new Error('Posting config validation error: config must be an object');
    }

    const accounts = input.accounts;
    const rawAccounts = accounts as unknown;
    if (typeof rawAccounts !== 'object' || rawAccounts === null || Array.isArray(rawAccounts)) {
      errors.push('accounts must be an object keyed by account name');
    } else {
      for (const [name, account] of Object.entries(accounts)) {
        errors.push(...validateAccount(name, account));
      }
    }

    this.accounts = freezeAccounts(accounts);
    this.requestTimeoutSecs = requireInteger(
      input.requestTimeoutSecs,
      'requestTimeoutSecs',
      MIN_REQUEST_TIMEOUT_SECS,
      MAX_REQUEST_TIMEOUT_SECS,
      DEFAULT_REQUEST_TIMEOUT_SECS,
      errors,
    );

    const logLevel = input.logLevel ?? 'warn';
    if (!LOG_LEVELS.includes(logLevel)) {
      errors.push(`logLevel must be one of ${LOG_LEVELS.join(', ')}`);
    }
    this.logLevel = LOG_LEVELS.includes(logLevel) ? logLevel : 'warn';

    if (input.strictResumeHandles !== undefined && typeof input.strictResumeHandles !== 'boolean') {
      errors.push('strictResumeHandles must be a boolean');
    }
    this.strictResumeHandles = input.strictResumeHandles === true;

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

function freezeAccounts(accounts: Record<string, AccountConfig>): Record<string, AccountConfig> {
  return freezeValue(accounts) as Record<string, AccountConfig>;
}

function freezeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return Object.freeze(value.map(freezeValue));
  }
  if (typeof value === 'object' && value !== null) {
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype === Object.prototype || prototype === null) {
      return Object.freeze(
        Object.fromEntries(
          Object.entries(value as Record<string, unknown>).map(([key, item]) => [
            key,
            freezeValue(item),
          ]),
        ),
      );
    }
  }
  return value;
}

function validateAccount(name: string, account: unknown): string[] {
  const errors: string[] = [];
  const prefix = `account "${name}"`;

  if (typeof account !== 'object' || account === null || Array.isArray(account)) {
    return [`${prefix}: must be an object`];
  }

  const { platform, auth, target, maxBodyLength, apiBaseUrl } = account as Partial<AccountConfig>;

  if (typeof platform !== 'string' || platform.trim().length === 0) {
    errors.push(`${prefix}: platform must be a non-empty string`);
  }

  const rawAuth = auth as unknown;
  if (
    rawAuth !== undefined &&
    (typeof rawAuth !== 'object' || rawAuth === null || Array.isArray(rawAuth))
  ) {
    errors.push(`${prefix}: auth must be an object`);
  }
  if (target !== undefined && !isValidTargetInput(target)) {
    errors.push(`${prefix}: target must be a string, a number, or an object with a non-empty id`);
  }
  if (apiBaseUrl !== undefined && !isAbsoluteHttpsUrl(apiBaseUrl)) {
    errors.push(`${prefix}: apiBaseUrl must be an absolute https URL`);
  }
  if (
    maxBodyLength !== undefined &&
    (typeof maxBodyLength !== 'number' || !Number.isInteger(maxBodyLength) || maxBodyLength < 1)
  ) {
    errors.push(`${prefix}: maxBodyLength must be a positive integer`);
  }

  return errors;
}
