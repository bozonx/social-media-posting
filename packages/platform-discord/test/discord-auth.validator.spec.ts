import { describe, expect, it } from 'vitest';
import {
  DiscordAuthValidator,
  authModeOf,
  parseWebhookUrl,
  validateDiscordAuth,
} from '../src/index.js';

const WEBHOOK =
  'https://discord.com/api/webhooks/1300000000000000004/aBcDeFgHiJkLmNoPqRsTuVwXyZ-0123456789';
const BOT = 'MTI5MDAwMDAwMDAwMDAwMDAw.GaBcDe.contract-suite-bot-token-value';

describe('validateDiscordAuth', () => {
  it('accepts a webhook URL', () => {
    expect(validateDiscordAuth({ webhookUrl: WEBHOOK }).errors).toEqual([]);
  });

  it('accepts a bot token', () => {
    expect(validateDiscordAuth({ botToken: BOT }).errors).toEqual([]);
  });

  it('rejects credentials carrying neither', () => {
    expect(validateDiscordAuth({}).errors).toEqual([
      "Discord auth requires either 'webhookUrl' or 'botToken'",
    ]);
  });

  it('refuses both at once rather than guessing which model applies', () => {
    const { errors } = validateDiscordAuth({ webhookUrl: WEBHOOK, botToken: BOT });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/exactly one/);
  });

  it('rejects a webhook URL on another host', () => {
    const { errors } = validateDiscordAuth({
      webhookUrl:
        'https://evil.example.com/api/webhooks/1300000000000000004/token-value-long-enough',
    });
    expect(errors[0]).toMatch(/invalid format/);
  });

  it('rejects a malformed bot token', () => {
    expect(validateDiscordAuth({ botToken: 'short' }).errors[0]).toMatch(/invalid format/);
  });

  it('is what the validator class delegates to', () => {
    const validator = new DiscordAuthValidator();
    expect(validator.providerName).toBe('discord');
    expect(validator.validate({ botToken: BOT }).errors).toEqual([]);
  });
});

describe('parseWebhookUrl', () => {
  it('splits the id and token out of the URL', () => {
    expect(parseWebhookUrl(WEBHOOK)).toEqual({
      id: '1300000000000000004',
      token: 'aBcDeFgHiJkLmNoPqRsTuVwXyZ-0123456789',
    });
  });

  it('accepts a versioned webhook URL', () => {
    expect(parseWebhookUrl(WEBHOOK.replace('/api/', '/api/v10/'))?.id).toBe('1300000000000000004');
  });

  it('returns undefined for anything else', () => {
    expect(parseWebhookUrl('https://discord.com/channels/1/2/3')).toBeUndefined();
  });
});

describe('authModeOf', () => {
  it('names the model the credentials select', () => {
    expect(authModeOf({ webhookUrl: WEBHOOK })).toBe('webhook');
    expect(authModeOf({ botToken: BOT })).toBe('bot');
    expect(authModeOf({})).toBeUndefined();
  });
});
