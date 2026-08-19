import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TelegramApi, TelegramApiFailure } from '../src/telegram-api.js';

const originalFetch = globalThis.fetch;

describe('TelegramApi', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('calls Bot API and returns result on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: { message_id: 42, chat: { id: 100 } } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const api = new TelegramApi('123:TOKEN');
    const result = await api.call<{ message_id: number }>('sendMessage', {
      chat_id: 100,
      text: 'Hello',
      parse_mode: undefined, // Should be stripped
    });

    expect(result).toEqual({ message_id: 42, chat: { id: 100 } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.telegram.org/bot123:TOKEN/sendMessage');
    expect(JSON.parse(String(init.body))).toEqual({
      chat_id: 100,
      text: 'Hello',
    });
  });

  it('throws TelegramApiFailure when API returns ok: false', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: false,
          error_code: 400,
          description: 'Bad Request: chat not found',
          parameters: { migrate_to_chat_id: -100123 },
        }),
        {
          status: 400,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const api = new TelegramApi('123:TOKEN');
    const error = await api
      .call('sendMessage', { chat_id: 999, text: 'Hi' })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(TelegramApiFailure);
    expect((error as TelegramApiFailure).name).toBe('TelegramApiFailure');
    expect((error as TelegramApiFailure).message).toBe('Bad Request: chat not found');
    expect((error as TelegramApiFailure).error_code).toBe(400);
    expect((error as TelegramApiFailure).description).toBe('Bad Request: chat not found');
    expect((error as TelegramApiFailure).parameters).toEqual({ migrate_to_chat_id: -100123 });
    expect((error as TelegramApiFailure).payload).toEqual({ method: 'sendMessage' });
  });

  it('throws TelegramApiFailure when HTTP status is not ok and JSON parsing fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('<html>Bad Gateway</html>', {
        status: 502,
        headers: { 'content-type': 'text/html' },
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const api = new TelegramApi('123:TOKEN');
    const error = await api
      .call('sendMessage', { chat_id: 100, text: 'Hi' })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(TelegramApiFailure);
    expect((error as TelegramApiFailure).error_code).toBe(502);
    expect((error as TelegramApiFailure).description).toContain('Telegram API responded with 502');
  });

  it('configures timeout and supports AbortSignal', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const controller = new AbortController();
    const api = new TelegramApi('123:TOKEN', 10);
    await api.call('getMe', {}, controller.signal);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBeDefined();
  });
});
