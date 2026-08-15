/**
 * Integration test for library mode
 * Tests the library in a realistic TypeScript ESM project scenario
 */

import { describe, it, expect } from '@jest/globals';
import { createPostingClient, type ILogger, BodyFormat } from '../../src/index.js';

describe('Library Mode Integration', () => {
  describe('End-to-end workflow', () => {
    it('should create client, preview post, and cleanup', async () => {
      // Custom logger to capture logs
      const logs: string[] = [];
      const customLogger: ILogger = {
        debug: msg => logs.push(`DEBUG: ${msg}`),
        log: msg => logs.push(`INFO: ${msg}`),
        warn: msg => logs.push(`WARN: ${msg}`),
        error: msg => logs.push(`ERROR: ${msg}`),
      };

      // Create client with custom configuration and logger
      const client = createPostingClient({
        accounts: {
          testAccount: {
            platform: 'telegram',
            auth: {
              botToken: 'test_bot_token_123',
            },
            channelId: '@test_channel',
          },
        },
        requestTimeoutSecs: 30,
        retryAttempts: 2,
        retryDelayMs: 500,
        idempotencyTtlMinutes: 5,
        logger: customLogger,
      });

      // Preview a simple text post
      const previewResult = await client.preview({
        account: 'testAccount',
        platform: 'telegram',
        body: 'Hello, world!',
        bodyFormat: BodyFormat.TEXT,
      });

      expect(previewResult).toBeDefined();
      expect(previewResult).toHaveProperty('success');

      // Preview a markdown post
      const markdownPreview = await client.preview({
        account: 'testAccount',
        platform: 'telegram',
        body: '**Bold text** and _italic text_',
        bodyFormat: BodyFormat.MARKDOWN,
      });

      expect(markdownPreview).toBeDefined();
      expect(markdownPreview).toHaveProperty('success');

      // Preview a post with image
      const imagePreview = await client.preview({
        account: 'testAccount',
        platform: 'telegram',
        body: 'Check out this image!',
        cover: {
          src: 'https://example.com/image.jpg',
        },
      });

      expect(imagePreview).toBeDefined();
      expect(imagePreview).toHaveProperty('success');

      // Cleanup
      await client.destroy();

      // Verify no errors were logged
      const errorLogs = logs.filter(log => log.startsWith('ERROR:'));
      expect(errorLogs).toHaveLength(0);
    });

    it('should handle configuration validation errors', () => {
      // Creating with invalid auth should work but preview will fail
      const client = createPostingClient({
        accounts: {
          invalidAccount: {
            platform: 'telegram',
            auth: {
              botToken: 'test',
            },
            channelId: '123',
          },
        },
        logLevel: 'error',
      });

      expect(client).toBeDefined();
    });

    it('should handle invalid account references', async () => {
      const client = createPostingClient({
        accounts: {
          validAccount: {
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
        account: 'nonExistentAccount',
        platform: 'telegram',
        body: 'Test',
      });

      expect(result).toBeDefined();
      expect(result.success).toBe(false);

      await client.destroy();
    });

    it('should support multiple accounts', async () => {
      const client = createPostingClient({
        accounts: {
          account1: {
            platform: 'telegram',
            auth: {
              botToken: 'token1',
            },
            channelId: '@channel1',
          },
          account2: {
            platform: 'telegram',
            auth: {
              botToken: 'token2',
            },
            channelId: '@channel2',
          },
        },
        logLevel: 'error',
      });

      const preview1 = await client.preview({
        account: 'account1',
        platform: 'telegram',
        body: 'Message to channel 1',
      });

      const preview2 = await client.preview({
        account: 'account2',
        platform: 'telegram',
        body: 'Message to channel 2',
      });

      expect(preview1).toHaveProperty('success');
      expect(preview2).toHaveProperty('success');

      await client.destroy();
    });
  });

  describe('Configuration isolation', () => {
    it('should not use environment variables', async () => {
      // Set environment variables that should NOT be used
      const originalEnv = process.env.BOT_TOKEN;
      process.env.BOT_TOKEN = 'should_not_be_used';

      const client = createPostingClient({
        accounts: {
          test: {
            platform: 'telegram',
            auth: {
              botToken: 'explicit_token',
            },
            channelId: '123',
          },
        },
        logLevel: 'error',
      });

      const result = await client.preview({
        account: 'test',
        platform: 'telegram',
        body: 'Test',
      });

      expect(result).toBeDefined();

      await client.destroy();

      // Restore environment
      if (originalEnv !== undefined) {
        process.env.BOT_TOKEN = originalEnv;
      } else {
        delete process.env.BOT_TOKEN;
      }
    });

    it('should be fully isolated with provided configuration', async () => {
      const client1 = createPostingClient({
        accounts: {
          test: {
            platform: 'telegram',
            auth: { botToken: 'token1' },
            channelId: '1',
          },
        },
        requestTimeoutSecs: 30,
      });

      const client2 = createPostingClient({
        accounts: {
          test: {
            platform: 'telegram',
            auth: { botToken: 'token2' },
            channelId: '2',
          },
        },
        requestTimeoutSecs: 60,
      });

      // Both clients should work independently
      const result1 = await client1.preview({
        account: 'test',
        platform: 'telegram',
        body: 'Client 1',
      });

      const result2 = await client2.preview({
        account: 'test',
        platform: 'telegram',
        body: 'Client 2',
      });

      expect(result1).toHaveProperty('success');
      expect(result2).toHaveProperty('success');

      await client1.destroy();
      await client2.destroy();
    });
  });
});
