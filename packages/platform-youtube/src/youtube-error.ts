import { ErrorCode, PlatformError } from '@bozonx/social-posting';

/** One item of the `errors` array a Google API returns. */
export interface GoogleErrorItem {
  domain?: string;
  reason?: string;
  message?: string;
  location?: string;
}

/** The JSON body a Google API returns on a failure. */
export interface YouTubeErrorBody {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    errors?: GoogleErrorItem[];
  };
}

/**
 * Reasons that mean the daily quota is spent, not that the request was wrong.
 *
 * YouTube charges 1600 units for one `videos.insert` against a default budget
 * of 10 000, so a host publishing six videos in a day hits this on the seventh
 * — routinely enough that it must read as "try tomorrow" rather than as a
 * broken request.
 */
const QUOTA_REASONS = new Set([
  'quotaExceeded',
  'dailyLimitExceeded',
  'uploadLimitExceeded',
  'rateLimitExceeded',
  'userRateLimitExceeded',
]);

/** Reasons that mean YouTube looked at the content and refused it. */
const CONTENT_REJECTED_REASONS = new Set([
  'invalidTitle',
  'invalidDescription',
  'invalidTags',
  'invalidVideoMetadata',
  'invalidCategoryId',
  'invalidFilename',
  'mediaBodyRequired',
  'videoTooLong',
  'uploadLimitExceeded',
  'failedPrecondition',
]);

/** Reasons that mean a human must grant something, not that a token is stale. */
const FORBIDDEN_REASONS = new Set([
  'forbidden',
  'insufficientPermissions',
  'youtubeSignupRequired',
  'accountClosed',
  'accountSuspended',
  'liveStreamingNotEnabled',
]);

/**
 * Translate a YouTube Data API failure into the library's error contract.
 *
 * The distinction that costs real money here is between a spent quota and a
 * rejected request. Both arrive as `403`, and a host that treats them alike
 * either burns its remaining budget retrying or drops a video it could have
 * uploaded an hour later.
 *
 * @param status - HTTP status of the failed response.
 * @param body - Parsed JSON error body, when there was one.
 * @param retryAfterHeader - The `retry-after` header, when present.
 * @returns The classified error to throw on.
 */
export function toPlatformError(
  status: number,
  body: YouTubeErrorBody | undefined,
  retryAfterHeader?: string | null,
): PlatformError {
  const error = body?.error;
  const first = error?.errors?.[0];
  const reason = first?.reason;
  const message = error?.message ?? first?.message ?? `YouTube responded with ${status}`;

  const shared = {
    httpStatus: status,
    platformCode: reason ?? error?.status ?? String(status),
    raw: { code: error?.code, status: error?.status, reason, message: error?.message },
  };

  const retryAfterMs = parseRetryAfter(retryAfterHeader);

  if (reason !== undefined && QUOTA_REASONS.has(reason)) {
    // Quota resets at midnight Pacific time, which no `retry-after` states.
    // Retryable, but not on the timescale a job queue would pick on its own.
    return new PlatformError(message, ErrorCode.QUOTA_EXCEEDED, {
      ...shared,
      retryable: true,
      retryAfterMs,
    });
  }

  if (status === 429) {
    return new PlatformError(message, ErrorCode.RATE_LIMIT_ERROR, {
      ...shared,
      retryable: true,
      retryAfterMs,
    });
  }

  if (status === 401) {
    // The access token is stale or revoked. The core's refresher runs before
    // the call, so reaching this means refreshing did not help and only the
    // user can fix it.
    return new PlatformError(message, ErrorCode.AUTH_REFRESH_REQUIRED, {
      ...shared,
      retryable: false,
    });
  }

  if (status === 403) {
    // A 403 here is one of two very different things: YouTube refusing the
    // file, or the channel not being allowed to upload at all. The second is
    // not fixed by editing the video, and the first is not fixed by
    // re-authorizing, so they must not share a code.
    if (reason !== undefined && CONTENT_REJECTED_REASONS.has(reason)) {
      return new PlatformError(message, ErrorCode.CONTENT_REJECTED, {
        ...shared,
        retryable: false,
      });
    }
    return new PlatformError(
      reason !== undefined && FORBIDDEN_REASONS.has(reason)
        ? `${message} (this channel is not permitted to upload; the account itself must be fixed)`
        : message,
      ErrorCode.AUTH_ERROR,
      { ...shared, retryable: false },
    );
  }

  if (status === 404) {
    return new PlatformError(message, ErrorCode.VALIDATION_ERROR, { ...shared, retryable: false });
  }

  if (status === 400) {
    return new PlatformError(
      message,
      reason !== undefined && CONTENT_REJECTED_REASONS.has(reason)
        ? ErrorCode.CONTENT_REJECTED
        : ErrorCode.VALIDATION_ERROR,
      { ...shared, retryable: false },
    );
  }

  if (status === 413) {
    return new PlatformError(message, ErrorCode.CONTENT_REJECTED, { ...shared, retryable: false });
  }

  if (status >= 500) {
    return new PlatformError(message, ErrorCode.PLATFORM_ERROR, {
      ...shared,
      retryable: true,
      retryAfterMs,
    });
  }

  return new PlatformError(message, ErrorCode.PLATFORM_ERROR, { ...shared, retryable: false });
}

/** `retry-after` in either of its two documented forms. */
function parseRetryAfter(header?: string | null): number | undefined {
  if (header === null || header === undefined || header === '') {
    return undefined;
  }
  const seconds = Number(header);
  if (Number.isFinite(seconds)) {
    return Math.max(0, Math.ceil(seconds * 1000));
  }
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}
