/**
 * Minimal in-process consumer.
 *
 * Shows the whole surface a host needs: build a client, hand it the platforms
 * it should serve, preview, publish. No HTTP, no framework, no globals.
 */
import { createPostingClient, PostType } from '@bozonx/social-posting';
import { telegram } from '@bozonx/social-posting-telegram';
import type { ILogger } from '@bozonx/social-posting';

const logger: ILogger = {
  debug: (message, context) => console.debug(`[${context ?? 'app'}] ${message}`),
  log: (message, context) => console.log(`[${context ?? 'app'}] ${message}`),
  warn: (message, context) => console.warn(`[${context ?? 'app'}] ${message}`),
  error: (message, trace, context) =>
    console.error(`[${context ?? 'app'}] ${message}`, trace ?? ''),
};

const client = createPostingClient({
  accounts: {
    myChannel: {
      platform: 'telegram',
      auth: { apiKey: process.env.TELEGRAM_BOT_TOKEN ?? '123456789:REPLACE-ME' },
      target: process.env.TELEGRAM_CHANNEL ?? '@your_channel',
    },
  },
  requestTimeoutSecs: 30,
  logger,
  platforms: [telegram],
});

const request = {
  platform: 'telegram',
  account: 'myChannel',
  type: PostType.POST,
  body: 'Hello from an embedded posting client.',
};

const preview = await client.preview(request);
console.log('preview:', JSON.stringify(preview, null, 2));

if (!preview.success) {
  process.exit(1);
}

// Publishing needs real credentials; opt in explicitly.
if (process.env.PUBLISH === '1') {
  const result = await client.post(request);
  console.log('publish:', JSON.stringify(result, null, 2));
}
