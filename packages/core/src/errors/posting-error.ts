import { ErrorCode } from './error-code.js';

/**
 * Base class for every error this library throws deliberately.
 *
 * Framework-free replacement for the HTTP exceptions the core used to throw:
 * the host decides how — or whether — to turn these into HTTP responses.
 */
export class PostingError extends Error {
  /** Machine-readable classification of the failure. */
  readonly code: ErrorCode;

  /**
   * Whether repeating the same call could succeed.
   *
   * This library never retries on the caller's behalf (beyond a single
   * transport-level retry before any bytes of a request body are sent). The
   * flag exists so the host's own backoff has something to key on.
   */
  readonly retryable: boolean;

  constructor(
    message: string,
    code: ErrorCode,
    options?: { cause?: unknown; retryable?: boolean },
  ) {
    super(message, { cause: options?.cause });
    this.name = new.target.name;
    this.code = code;
    this.retryable = options?.retryable ?? false;
  }
}

/**
 * The request cannot be published as given. Never retryable: the same input
 * fails the same way.
 */
export class ValidationError extends PostingError {
  /** Individual validation messages, when the failure has more than one cause. */
  readonly errors: string[];

  constructor(errors: string | string[], options?: { cause?: unknown }) {
    const list = Array.isArray(errors) ? errors : [errors];
    super(list.join('; '), ErrorCode.VALIDATION_ERROR, { cause: options?.cause });
    this.errors = list;
  }
}

/**
 * The operation was cancelled through an {@link AbortSignal} or because the
 * configured request timeout elapsed.
 */
export class AbortedError extends PostingError {
  constructor(message = 'Operation aborted', code: ErrorCode = ErrorCode.TIMEOUT_ERROR) {
    // The caller aborted or ran out of time; whether that is worth repeating is
    // the host's call, and a timeout usually is.
    super(message, code, { retryable: code === ErrorCode.TIMEOUT_ERROR });
  }
}
