/**
 * Register a network the library has never heard of, and publish to it.
 */
import { createPostingClient } from '@bozonx/social-posting';
import { pastebin } from './pastebin.platform.js';

const client = createPostingClient({
  accounts: {
    notes: { platform: 'pastebin', auth: { apiKey: process.env.PASTEBIN_KEY ?? 'demo' } },
  },
  logLevel: 'info',
  platforms: [pastebin],
});

console.log('registered platforms:', client.getRegisteredPlatforms());
console.log('capabilities:', JSON.stringify(client.getCapabilities('pastebin'), null, 2));

const preview = await client.preview({
  platform: 'pastebin',
  account: 'notes',
  body: 'A network implemented entirely outside the library.',
  tags: ['ignored'],
});

console.log('preview:', JSON.stringify(preview, null, 2));
