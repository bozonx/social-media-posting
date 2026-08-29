import { describe, expect, it, vi } from 'vitest';
import { createPostingClient, PostType } from '@bozonx/social-posting';
import { telegram } from '@bozonx/social-posting-telegram';
import type { ILogger } from '@bozonx/social-posting';

function recordingLogger(): ILogger & { lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    debug: message => lines.push(`debug:${message}`),
    log: message => lines.push(`log:${message}`),
    warn: message => lines.push(`warn:${message}`),
    error: message => lines.push(`error:${message}`),
  };
}

function clientWith(logger: ILogger, apiKey: string, target: string) {
  return createPostingClient({
    accounts: {
      main: { platform: 'telegram', auth: { apiKey }, target },
    },
    logger,
    platforms: [telegram],
  });
}

describe('embedded consumer isolation', () => {
  it('keeps two clients in one process independent', async () => {
    const loggerA = recordingLogger();
    const loggerB = recordingLogger();

    const clientA = clientWith(loggerA, '111111111:AAA-aaa-valid-token-value', '@channel_a');
    const clientB = clientWith(loggerB, '222222222:BBB-bbb-valid-token-value', '@channel_b');

    const previewA = await clientA.preview({
      platform: 'telegram',
      account: 'main',
      type: PostType.POST,
      body: 'from A',
    });
    const previewB = await clientB.preview({
      platform: 'telegram',
      account: 'unknown',
      type: PostType.POST,
      body: 'from B',
    });

    expect(previewA.success).toBe(true);
    expect(previewB.success).toBe(false);
    // Failure in one client is reported only through that client's logger.
    expect(loggerB.lines.some(line => line.startsWith('warn:'))).toBe(true);
    expect(loggerA.lines.some(line => line.startsWith('warn:'))).toBe(false);
  });

  it('never writes to the host console', async () => {
    const spies = {
      log: vi.spyOn(console, 'log').mockImplementation(() => {}),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
      debug: vi.spyOn(console, 'debug').mockImplementation(() => {}),
    };

    try {
      const logger = recordingLogger();
      const client = clientWith(logger, '333333333:CCC-ccc-valid-token-value', '@channel_c');
      await client.preview({ platform: 'telegram', account: 'main', body: 'quiet' });

      for (const spy of Object.values(spies)) {
        expect(spy).not.toHaveBeenCalled();
      }
    } finally {
      for (const spy of Object.values(spies)) {
        spy.mockRestore();
      }
    }
  });

  it('exposes only the platforms it was given', () => {
    const logger = recordingLogger();
    const bare = createPostingClient({ accounts: {}, logger });
    expect(bare.getRegisteredPlatforms()).toEqual([]);

    const withTelegram = clientWith(logger, '444444444:DDD-ddd-valid-token-value', '@channel_d');
    expect(withTelegram.getRegisteredPlatforms()).toEqual(['telegram']);
  });
});
