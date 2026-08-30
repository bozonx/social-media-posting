import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PostType, ValidationError } from '@bozonx/social-posting';
import type { ILogger, PostRequest } from '@bozonx/social-posting';
import { DiscordPlatform } from '../src/index.js';
import type { DiscordAccountConfig } from '../src/index.js';
import success from './fixtures/success.json' with { type: 'json' };

const silentLogger: ILogger = { debug: () => {}, log: () => {}, warn: () => {}, error: () => {} };

const WEBHOOK =
  'https://discord.com/api/webhooks/1300000000000000004/aBcDeFgHiJkLmNoPqRsTuVwXyZ-0123456789';
const BOT = 'MTI5MDAwMDAwMDAwMDAwMDAw.GaBcDe.contract-suite-bot-token-value';

const botAccount: DiscordAccountConfig = {
  platform: 'discord',
  auth: { botToken: BOT },
  target: { id: '1290000000000000002', guildId: '1280000000000000003' },
};

const webhookAccount: DiscordAccountConfig = {
  platform: 'discord',
  auth: { webhookUrl: WEBHOOK },
};

/** Every call the platform made, so a test can assert on the request it built. */
interface RecordedCall {
  url: string;
  method: string;
  headers: Headers;
  body?: BodyInit | null;
}

let calls: RecordedCall[] = [];
let platform: DiscordPlatform;
let originalFetch: typeof globalThis.fetch;

/** Answer message calls with a recorded message, and media URLs with bytes. */
function respond(bodyFor: (url: string) => { status: number; body: unknown }) {
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      url,
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: init?.body,
    });

    if (url.includes('cdn.example.com')) {
      return Promise.resolve(
        new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), {
          status: 200,
          headers: { 'content-type': 'image/jpeg', 'content-length': '4' },
        }),
      );
    }

    const recorded = bodyFor(url);
    return Promise.resolve(
      new Response(recorded.status === 204 ? null : JSON.stringify(recorded.body), {
        status: recorded.status,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as unknown as typeof fetch;
}

/** The `payload_json` part of the last multipart request. */
async function lastPayloadJson(): Promise<Record<string, unknown>> {
  const body = calls.at(-1)?.body;
  if (body instanceof FormData) {
    return JSON.parse(String(body.get('payload_json'))) as Record<string, unknown>;
  }
  return JSON.parse(String(body)) as Record<string, unknown>;
}

beforeEach(() => {
  originalFetch = globalThis.fetch;
  calls = [];
  platform = new DiscordPlatform({ logger: silentLogger });
  respond(() => success.botMessage);
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const post: PostRequest = { platform: 'discord', type: PostType.POST, body: 'hello' };

describe('addressing', () => {
  it('posts to the channel named by the target with a bot token', async () => {
    await platform.publish(post, botAccount);
    expect(calls[0]?.url).toBe('https://discord.com/api/v10/channels/1290000000000000002/messages');
    expect(calls[0]?.headers.get('authorization')).toBe(`Bot ${BOT}`);
  });

  it('posts through the webhook URL, which needs no target at all', async () => {
    respond(() => success.webhookMessage);
    await platform.publish(post, webhookAccount);

    const url = new URL(calls[0]?.url as string);
    expect(url.pathname).toBe(
      '/api/v10/webhooks/1300000000000000004/aBcDeFgHiJkLmNoPqRsTuVwXyZ-0123456789',
    );
    // Without `wait=true` Discord answers 204 and the message id is lost.
    expect(url.searchParams.get('wait')).toBe('true');
    expect(calls[0]?.headers.get('authorization')).toBeNull();
  });

  it('addresses a thread as the channel it is', async () => {
    await platform.publish(
      { ...post, target: { id: '1290000000000000002', threadId: '1295000000000000007' } },
      botAccount,
    );
    expect(calls[0]?.url).toContain('/channels/1295000000000000007/messages');
  });

  it('passes a thread to a webhook as a query parameter', async () => {
    respond(() => success.webhookMessage);
    await platform.publish(
      { ...post, target: { id: '1290000000000000002', threadId: '1295000000000000007' } },
      webhookAccount,
    );
    expect(new URL(calls[0]?.url as string).searchParams.get('thread_id')).toBe(
      '1295000000000000007',
    );
  });

  it('honours a per-account apiBaseUrl', async () => {
    await platform.publish(post, { ...botAccount, apiBaseUrl: 'https://proxy.example/api' });
    expect(calls[0]?.url).toBe(
      'https://proxy.example/api/v10/channels/1290000000000000002/messages',
    );
  });

  it('requires a channel for a bot account', async () => {
    await expect(platform.publish(post, { ...botAccount, target: undefined })).rejects.toThrow(
      ValidationError,
    );
  });

  it('builds a permalink from the guild and channel', async () => {
    const result = await platform.publish(post, botAccount);
    expect(result.url).toBe(
      'https://discord.com/channels/1280000000000000003/1290000000000000002/1310000000000000001',
    );
  });

  it('records the channel from the response, which a webhook never stated', async () => {
    respond(() => success.webhookMessage);
    const result = await platform.publish(post, webhookAccount);
    expect(result.ref?.target).toEqual({
      id: '1290000000000000002',
      guildId: '1280000000000000003',
    });
  });
});

describe('access models differ, and are not papered over', () => {
  it('refuses a reply through a webhook rather than dropping it', async () => {
    await expect(
      platform.publish({ ...post, inReplyTo: { id: '1310000000000000001' } }, webhookAccount),
    ).rejects.toThrow(/cannot reply/);
  });

  it('sends a reply as a message reference for a bot', async () => {
    await platform.publish({ ...post, inReplyTo: { id: '1310000000000000001' } }, botAccount);
    expect((await lastPayloadJson()).message_reference).toEqual({
      message_id: '1310000000000000001',
      fail_if_not_exists: false,
    });
  });

  it('refuses webhook-only presentation options on a bot account', async () => {
    await expect(
      platform.publish({ ...post, extra: { username: 'Announcer' } }, botAccount),
    ).rejects.toThrow(/only a webhook accepts/);
  });

  it('passes a webhook name and avatar through', async () => {
    respond(() => success.webhookMessage);
    await platform.publish(
      { ...post, extra: { username: 'Announcer', avatar_url: 'https://cdn.example.com/a.png' } },
      webhookAccount,
    );
    const payload = await lastPayloadJson();
    expect(payload.username).toBe('Announcer');
  });

  it('refuses credentials carrying neither model', async () => {
    await expect(
      platform.publish(post, { platform: 'discord', auth: {}, target: { id: '1' } }),
    ).rejects.toThrow(ValidationError);
  });
});

describe('attachments', () => {
  const image = {
    type: 'image' as const,
    source: { kind: 'url' as const, url: 'https://cdn.example.com/1.jpg' },
  };

  it('uploads a downloaded URL as multipart rather than handing Discord the link', async () => {
    await platform.publish(
      { ...post, type: PostType.IMAGE, media: [{ ...image, altText: 'A red square' }] },
      botAccount,
    );

    const body = calls.at(-1)?.body;
    expect(body).toBeInstanceOf(FormData);
    const form = body as FormData;
    expect(form.get('files[0]')).toBeInstanceOf(Blob);

    const payload = await lastPayloadJson();
    expect(payload.attachments).toEqual([
      { id: 0, filename: 'file-0', description: 'A red square' },
    ]);
  });

  it('spoilers an attachment through the file name, the only way Discord has', async () => {
    await platform.publish(
      {
        ...post,
        type: PostType.IMAGE,
        media: [{ ...image, fileName: 'leak.jpg', sensitive: true }],
      },
      botAccount,
    );
    const payload = (await lastPayloadJson()).attachments as Array<{ filename: string }>;
    expect(payload[0]?.filename).toBe('SPOILER_leak.jpg');
  });

  it('keeps album order, because the order is what the caller composed', async () => {
    await platform.publish(
      {
        ...post,
        type: PostType.ALBUM,
        media: [
          { ...image, fileName: 'first.jpg' },
          { ...image, fileName: 'second.jpg' },
        ],
      },
      botAccount,
    );
    const attachments = (await lastPayloadJson()).attachments as Array<{ filename: string }>;
    expect(attachments.map(a => a.filename)).toEqual(['first.jpg', 'second.jpg']);
  });

  it('refuses more attachments than one message can carry, before any call', async () => {
    calls = [];
    await expect(
      platform.publish(
        { ...post, type: PostType.ALBUM, media: Array.from({ length: 11 }, () => image) },
        botAccount,
      ),
    ).rejects.toThrow(ValidationError);
    expect(calls).toHaveLength(0);
  });

  it('refuses a stored-file reference, which Discord does not have', async () => {
    await expect(
      platform.publish(
        {
          ...post,
          type: PostType.IMAGE,
          media: [{ type: 'image', source: { kind: 'platformRef', ref: 'abc' } }],
        },
        botAccount,
      ),
      // The descriptor refuses it before any code runs: Discord has no
      // re-usable file ids, so `platformRef` is not an accepted source.
    ).rejects.toThrow(/does not accept source kind 'platformRef'/);
  });
});

describe('polls', () => {
  it('maps a poll onto Discord’s own object, in whole hours', async () => {
    await platform.publish(
      {
        ...post,
        body: undefined,
        type: PostType.POLL,
        title: 'Lunch?',
        poll: { options: ['Pizza', 'Sushi'], durationSecs: 7_200, multiple: true },
      },
      botAccount,
    );

    expect((await lastPayloadJson()).poll).toEqual({
      question: { text: 'Lunch?' },
      answers: [{ poll_media: { text: 'Pizza' } }, { poll_media: { text: 'Sushi' } }],
      duration: 2,
      allow_multiselect: true,
    });
  });

  it('refuses a duration Discord cannot express instead of rounding it silently', async () => {
    await expect(
      platform.publish(
        {
          ...post,
          body: undefined,
          type: PostType.POLL,
          title: 'Lunch?',
          poll: { options: ['Pizza'], durationSecs: 5_400 },
        },
        botAccount,
      ),
    ).rejects.toThrow(/whole hours/);
  });

  it('refuses an anonymous poll, which Discord has no way to create', async () => {
    await expect(
      platform.publish(
        {
          ...post,
          body: undefined,
          type: PostType.POLL,
          title: 'Lunch?',
          poll: { options: ['Pizza'], anonymous: true },
        },
        botAccount,
      ),
    ).rejects.toThrow(/anonymous/);
  });
});

describe('protected fields', () => {
  it('refuses extra keys that would overwrite what the adapter builds', async () => {
    await expect(
      platform.publish({ ...post, extra: { content: 'hijacked' } }, botAccount),
    ).rejects.toThrow(/protected/);
  });
});

describe('resolveCapabilities', () => {
  it('reads the attachment ceiling from the server’s boost tier', async () => {
    respond(() => success.guild);
    const resolved = await platform.resolveCapabilities(botAccount);

    expect(calls[0]?.url).toBe('https://discord.com/api/v10/guilds/1280000000000000003');
    expect(resolved.capabilities.media?.image?.maxBytes).toBe(50 * 1024 * 1024);
    expect(resolved.capabilities.media?.video?.maxBytes).toBe(50 * 1024 * 1024);
    expect(resolved.cacheableForSecs).toBe(3_600);
  });

  it('keeps the unboosted floor for a webhook, which cannot read the server', async () => {
    const resolved = await platform.resolveCapabilities(webhookAccount);
    expect(resolved.capabilities).toEqual({});
    expect(calls).toHaveLength(0);
  });
});

describe('delete', () => {
  it('deletes a bot message by channel and message id', async () => {
    respond(() => ({ status: 204, body: null }));
    const outcome = await platform.delete({ postId: '1310000000000000001' }, botAccount);

    expect(calls[0]?.method).toBe('DELETE');
    expect(calls[0]?.url).toBe(
      'https://discord.com/api/v10/channels/1290000000000000002/messages/1310000000000000001',
    );
    expect(outcome.status).toBe('deleted');
  });

  it('deletes a webhook message through the webhook token', async () => {
    respond(() => ({ status: 204, body: null }));
    await platform.delete({ postId: '1310000000000000009' }, webhookAccount);
    expect(calls[0]?.url).toContain(
      '/webhooks/1300000000000000004/aBcDeFgHiJkLmNoPqRsTuVwXyZ-0123456789/messages/1310000000000000009',
    );
  });

  it('treats an already-deleted message as settled, not as a failure', async () => {
    respond(() => ({ status: 404, body: { message: 'Unknown Message', code: 10008 } }));
    const outcome = await platform.delete({ postId: '1310000000000000001' }, botAccount);
    expect(outcome.status).toBe('deleted');
    expect(outcome.parts?.[0]?.status).toBe('alreadyGone');
  });
});
