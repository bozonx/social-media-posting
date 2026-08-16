import { ErrorCode, PlatformError } from '@bozonx/social-posting';

/**
 * The error shape grammY raises for a Bot API failure, plus the fields the Bot
 * API itself returns.
 */
interface TelegramApiError {
  message?: string;
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number; migrate_to_chat_id?: number };
  payload?: Record<string, unknown>;
}

/** Bot API descriptions that mean the content itself was refused. */
const CONTENT_REJECTED_PATTERNS = [
  'wrong file identifier',
  'wrong type of the web page content',
  'photo_invalid_dimensions',
  'file is too big',
  'message text is empty',
  "can't parse entities",
];

/**
 * Translate a Bot API failure into the library's error contract.
 *
 * This is the only place Telegram's error vocabulary is read. The core stays
 * out of it: it sees a {@link PlatformError} with a code, `retryable`, and the
 * `retryAfterMs` Telegram asked for.
 *
 * @param error - Whatever the Bot API call threw.
 * @returns The classified error to throw on.
 */
export function toPlatformError(error: unknown): PlatformError {
  if (error instanceof PlatformError) {
    return error;
  }

  const api = (error ?? {}) as TelegramApiError;
  const status = api.error_code;
  const description = api.description ?? api.message ?? 'Telegram API request failed';
  // Telegram states the cool-down in whole seconds on 429.
  const retryAfterMs =
    typeof api.parameters?.retry_after === 'number' ? api.parameters.retry_after * 1000 : undefined;

  const shared = {
    httpStatus: status,
    platformCode: status === undefined ? undefined : String(status),
    cause: error,
    raw: { description: api.description, parameters: api.parameters, payload: api.payload },
  };

  if (status === 429) {
    return new PlatformError(description, ErrorCode.RATE_LIMIT_ERROR, {
      ...shared,
      retryable: true,
      retryAfterMs,
    });
  }

  if (status === 401) {
    // A bot token is static: a rejected one is wrong, not stale.
    return new PlatformError(description, ErrorCode.AUTH_ERROR, { ...shared, retryable: false });
  }

  if (status === 403) {
    return new PlatformError(description, ErrorCode.AUTH_ERROR, { ...shared, retryable: false });
  }

  if (status === 400) {
    const lower = description.toLowerCase();
    const rejected = CONTENT_REJECTED_PATTERNS.some(pattern => lower.includes(pattern));
    return new PlatformError(
      description,
      rejected ? ErrorCode.CONTENT_REJECTED : ErrorCode.VALIDATION_ERROR,
      {
        ...shared,
        retryable: false,
      },
    );
  }

  if (status !== undefined && status >= 500) {
    return new PlatformError(description, ErrorCode.PLATFORM_ERROR, {
      ...shared,
      retryable: true,
      retryAfterMs,
    });
  }

  // No Bot API status at all: the call never reached Telegram.
  return new PlatformError(description, ErrorCode.NETWORK_ERROR, { ...shared, retryable: true });
}
