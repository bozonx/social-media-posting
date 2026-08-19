import type { ErrorCode } from './error-code.js';
import { PostingError } from './posting-error.js';
import type { ResumeHandle } from '../types/resume-handle.js';

/**
 * Everything a platform knows about a failure, in the one shape the host reads.
 */
export interface PlatformErrorOptions {
  /** Whether repeating the call could succeed. */
  retryable?: boolean;
  /** How long to wait before repeating, when the platform said so. */
  retryAfterMs?: number;
  /** HTTP status the platform answered with. */
  httpStatus?: number;
  /** Platform's own error code, verbatim (e.g. Telegram's `error_code`). */
  platformCode?: string;
  /** Progress that a resumed call can continue from. */
  resumeHandle?: ResumeHandle;
  /** The underlying error or response. */
  cause?: unknown;
  /** Raw error payload from the platform, for logging. */
  raw?: unknown;
}

/**
 * A failure reported by a platform.
 *
 * Platforms throw this; the core never sniffs strings or pokes at
 * vendor-specific error fields. Everything the host needs to schedule its own
 * retry — whether to retry at all, how long to wait, and where to resume from —
 * travels on this object.
 */
export class PlatformError extends PostingError {
  /** How long to wait before repeating, when the platform said so. */
  readonly retryAfterMs?: number;
  /** HTTP status the platform answered with. */
  readonly httpStatus?: number;
  /** Platform's own error code, verbatim. */
  readonly platformCode?: string;
  /** Progress that a resumed call can continue from. */
  readonly resumeHandle?: ResumeHandle;
  /** Raw error payload from the platform, for logging. */
  readonly raw?: unknown;

  constructor(message: string, code: ErrorCode, options: PlatformErrorOptions = {}) {
    super(message, code, { cause: options.cause, retryable: options.retryable ?? false });
    this.retryAfterMs = options.retryAfterMs;
    this.httpStatus = options.httpStatus;
    this.platformCode = options.platformCode;
    this.resumeHandle = options.resumeHandle;
    this.raw = options.raw;
  }
}
