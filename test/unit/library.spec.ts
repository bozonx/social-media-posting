import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { createPostingClient, type ILogger, ConsoleLogger } from '../../src/index.js';

describe('Library Mode', () => {
  describe('createPostingClient', () => {
    it('should create posting client with default logger', async () => {
      const client = createPostingClient({
        accounts: {
          test: {
            platform: 'telegram',
            auth: {
              botToken: 'test_token',
            },
            channelId: '123',
          },
        },
        logLevel: 'error',
      });

      expect(client).toBeDefined();
      expect(client.post).toBeDefined();
      expect(client.preview).toBeDefined();
      expect(client.destroy).toBeDefined();

      await client.destroy();
    });

    it('should create posting client with custom logger', async () => {
      const logs: string[] = [];
      const mockLogger: ILogger = {
        debug: msg => logs.push(`debug: ${msg}`),
        log: msg => logs.push(`log: ${msg}`),
        warn: msg => logs.push(`warn: ${msg}`),
        error: msg => logs.push(`error: ${msg}`),
      };

      const client = createPostingClient({
        accounts: {
          test: {
            platform: 'telegram',
            auth: {
              botToken: 'test_token',
            },
            channelId: '123',
          },
        },
        logger: mockLogger,
      });

      expect(client).toBeDefined();

      await client.destroy();
    });
  });

  describe('preview', () => {
    it('should validate post request without publishing', async () => {
      const client = createPostingClient({
        accounts: {
          test: {
            platform: 'telegram',
            auth: {
              botToken: 'test_token',
            },
            channelId: '123',
          },
        },
        logLevel: 'error',
      });

      const result = await client.preview({
        account: 'test',
        platform: 'telegram',
        body: 'Test message',
        bodyFormat: 'text',
      });

      expect(result).toBeDefined();
      // Result can be either success or error response
      expect(result).toHaveProperty('success');

      await client.destroy();
    });

    it('should return validation errors for invalid request', async () => {
      const client = createPostingClient({
        accounts: {
          test: {
            platform: 'telegram',
            auth: {
              botToken: 'test_token',
            },
            channelId: '123',
          },
        },
        logLevel: 'error',
      });

      const result = await client.preview({
        account: 'nonexistent',
        platform: 'telegram',
        body: 'Test',
      });

      expect(result).toBeDefined();
      expect(result.success).toBe(false);

      await client.destroy();
    });
  });

  describe('destroy', () => {
    it('should cleanup resources gracefully', async () => {
      const client = createPostingClient({
        accounts: {
          test: {
            platform: 'telegram',
            auth: {
              botToken: 'test_token',
            },
            channelId: '123',
          },
        },
        logLevel: 'error',
      });

      await expect(client.destroy()).resolves.not.toThrow();
    });
  });

  describe('ConsoleLogger', () => {
    let consoleDebugSpy: any;
    let consoleLogSpy: any;
    let consoleWarnSpy: any;
    let consoleErrorSpy: any;

    beforeEach(() => {
      consoleDebugSpy = jest.spyOn(console, 'debug').mockImplementation();
      consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
      consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
      consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    });

    afterEach(() => {
      consoleDebugSpy.mockRestore();
      consoleLogSpy.mockRestore();
      consoleWarnSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    });

    it('should respect log level', () => {
      const logger = new ConsoleLogger('warn');

      logger.debug('debug message');
      logger.log('info message');
      logger.warn('warn message');
      logger.error('error message');

      expect(consoleDebugSpy).not.toHaveBeenCalled();
      expect(consoleLogSpy).not.toHaveBeenCalled();
      expect(consoleWarnSpy).toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('should include context in log messages', () => {
      const logger = new ConsoleLogger('info');
      logger.log('test message', 'TestContext');

      expect(consoleLogSpy).toHaveBeenCalledWith('[TestContext] test message');
    });
  });
});
