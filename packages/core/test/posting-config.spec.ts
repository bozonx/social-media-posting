import { describe, expect, it } from 'vitest';
import { PostingConfig } from '../src/config/posting-config.js';

describe('PostingConfig', () => {
  const validAccount = {
    platform: 'telegram',
    auth: { apiKey: '123:ABC' },
    target: '@my_channel',
    maxBodyLength: 4096,
  };

  describe('valid configuration', () => {
    it('creates config with defaults for requestTimeoutSecs (60) and logLevel (warn)', () => {
      const config = new PostingConfig({
        accounts: { main: validAccount },
      });

      expect(config.requestTimeoutSecs).toBe(60);
      expect(config.logLevel).toBe('warn');
      expect(config.getAccount('main')).toEqual(validAccount);
      expect(config.getAllAccounts()).toEqual({ main: validAccount });
    });

    it('accepts custom valid requestTimeoutSecs and logLevel', () => {
      const config = new PostingConfig({
        accounts: { main: validAccount },
        requestTimeoutSecs: 120,
        logLevel: 'debug',
      });

      expect(config.requestTimeoutSecs).toBe(120);
      expect(config.logLevel).toBe('debug');
    });

    it('freezes account configuration objects to prevent mutations', () => {
      const config = new PostingConfig({
        accounts: { main: { ...validAccount, auth: { apiKey: 'secret' } } },
      });

      const account = config.getAccount('main');
      expect(Object.isFrozen(account)).toBe(true);
      expect(Object.isFrozen(account.auth)).toBe(true);
      expect(() => {
        (account as Record<string, unknown>).platform = 'other';
      }).toThrow();
    });
  });

  describe('configuration validation errors', () => {
    it('rejects null or non-object root config', () => {
      expect(() => new PostingConfig(null as never)).toThrow(
        'Posting config validation error: config must be an object',
      );
      expect(() => new PostingConfig('invalid' as never)).toThrow(
        'Posting config validation error: config must be an object',
      );
    });

    it('rejects null, array, or non-object accounts', () => {
      expect(() => new PostingConfig({ accounts: null as never })).toThrow(
        'accounts must be an object keyed by account name',
      );
      expect(() => new PostingConfig({ accounts: [] as never })).toThrow(
        'accounts must be an object keyed by account name',
      );
    });

    it('rejects non-object account values', () => {
      expect(() => new PostingConfig({ accounts: { main: 'not an object' as never } })).toThrow(
        'account "main": must be an object',
      );
    });

    it('rejects account with empty or missing platform', () => {
      expect(() => new PostingConfig({ accounts: { main: { platform: '', auth: {} } } })).toThrow(
        'account "main": platform must be a non-empty string',
      );
      expect(
        () => new PostingConfig({ accounts: { main: { platform: 123 as never, auth: {} } } }),
      ).toThrow('account "main": platform must be a non-empty string');
    });

    it('rejects account with non-object auth', () => {
      expect(
        () =>
          new PostingConfig({
            accounts: { main: { platform: 'telegram', auth: 'token' as never } },
          }),
      ).toThrow('account "main": auth must be an object');
    });

    it('rejects account with invalid target type', () => {
      expect(
        () =>
          new PostingConfig({
            accounts: {
              main: { platform: 'telegram', target: true as never, auth: {} },
            },
          }),
      ).toThrow(
        'account "main": target must be a string, a number, or an object with a non-empty id',
      );
    });

    it('rejects account with non-positive or non-integer maxBodyLength', () => {
      expect(
        () =>
          new PostingConfig({
            accounts: {
              main: { platform: 'telegram', maxBodyLength: 0, auth: {} },
            },
          }),
      ).toThrow('account "main": maxBodyLength must be a positive integer');

      expect(
        () =>
          new PostingConfig({
            accounts: {
              main: { platform: 'telegram', maxBodyLength: 10.5, auth: {} },
            },
          }),
      ).toThrow('account "main": maxBodyLength must be a positive integer');
    });

    it('rejects invalid requestTimeoutSecs (< 1, > 600, or non-integer)', () => {
      expect(
        () => new PostingConfig({ accounts: { main: validAccount }, requestTimeoutSecs: 0 }),
      ).toThrow('requestTimeoutSecs must be an integer between 1 and 600');

      expect(
        () => new PostingConfig({ accounts: { main: validAccount }, requestTimeoutSecs: 601 }),
      ).toThrow('requestTimeoutSecs must be an integer between 1 and 600');

      expect(
        () => new PostingConfig({ accounts: { main: validAccount }, requestTimeoutSecs: 30.5 }),
      ).toThrow('requestTimeoutSecs must be an integer between 1 and 600');
    });

    it('rejects invalid logLevel values', () => {
      expect(
        () =>
          new PostingConfig({
            accounts: { main: validAccount },
            logLevel: 'verbose' as never,
          }),
      ).toThrow('logLevel must be one of debug, info, warn, error');
    });
  });

  describe('getAccount', () => {
    it('throws when account name is not found', () => {
      const config = new PostingConfig({ accounts: { main: validAccount } });

      expect(() => config.getAccount('secondary')).toThrow(
        'Account "secondary" not found in configuration',
      );
    });
  });
});
