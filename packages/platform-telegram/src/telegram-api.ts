import { httpRequest } from '@bozonx/social-posting/platform';

const API_ROOT = 'https://api.telegram.org';

/** The envelope every Bot API method answers with. */
interface BotApiResponse<T> {
  ok: boolean;
  result?: T;
  error_code?: number;
  description?: string;
  parameters?: { retry_after?: number; migrate_to_chat_id?: number };
}

/**
 * A failed Bot API call, in the shape `toPlatformError()` reads.
 *
 * Not a `PlatformError` yet: this is the raw platform vocabulary, and turning
 * it into the library's contract is one clearly separate step.
 */
export class TelegramApiFailure extends Error {
  readonly error_code?: number;
  readonly description?: string;
  readonly parameters?: BotApiResponse<unknown>['parameters'];
  readonly payload?: Record<string, unknown>;

  constructor(opts: {
    error_code?: number;
    description?: string;
    parameters?: BotApiResponse<unknown>['parameters'];
    payload?: Record<string, unknown>;
    message: string;
  }) {
    super(opts.message);
    this.name = 'TelegramApiFailure';
    this.error_code = opts.error_code;
    this.description = opts.description;
    this.parameters = opts.parameters;
    this.payload = opts.payload;
  }
}

/**
 * The Bot API over plain `fetch`.
 *
 * No SDK: an SDK wraps the failure in its own class and loses exactly what this
 * library needs — the HTTP status, `retry_after` and the platform's own code —
 * and most of them pull Node bindings that will not run on Workers.
 */
export class TelegramApi {
  private readonly token: string;
  private readonly timeoutMs?: number;
  private readonly fetch?: typeof fetch;

  constructor(token: string, timeoutSeconds?: number, customFetch?: typeof fetch) {
    this.token = token;
    this.timeoutMs = timeoutSeconds === undefined ? undefined : timeoutSeconds * 1000;
    this.fetch = customFetch;
  }

  /**
   * Call one Bot API method.
   * @param method - Bot API method name, e.g. `sendMessage`.
   * @param payload - JSON body; `undefined` values are dropped.
   * @param signal - Aborts the call.
   * @returns The `result` field of a successful response.
   * @throws TelegramApiFailure when the Bot API answers `ok: false`.
   */
  async call<T>(
    method: string,
    payload: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<T> {
    const url = `${API_ROOT}/bot${this.token}/${method}`;
    const body = JSON.stringify(stripUndefined(payload));

    const response = await httpRequest(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      signal: this.withTimeout(signal),
      fetch: this.fetch,
    });

    const parsed = (await response.json().catch(() => ({}))) as BotApiResponse<T>;

    if (!response.ok || !parsed.ok) {
      const description = parsed.description ?? `Telegram API responded with ${response.status}`;
      const failure = new TelegramApiFailure({
        error_code: parsed.error_code ?? response.status,
        description,
        parameters: parsed.parameters,
        payload: { method },
        message: description,
      });
      throw failure;
    }

    return parsed.result as T;
  }

  /**
   * Combine the caller's signal with the account's own API timeout, so a slow
   * Bot API call cannot outlive either.
   */
  private withTimeout(signal?: AbortSignal): AbortSignal | undefined {
    if (this.timeoutMs === undefined) {
      return signal;
    }
    const timeout = AbortSignal.timeout(this.timeoutMs);
    return signal ? AbortSignal.any([signal, timeout]) : timeout;
  }
}

/** The Bot API rejects explicit nulls, so absent options are simply omitted. */
function stripUndefined(payload: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}
