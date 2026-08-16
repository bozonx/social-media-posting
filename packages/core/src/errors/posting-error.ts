import { ErrorCode } from './error-code.js';

/**
 * Base class for every error this library throws deliberately.
 *
 * Framework-free replacement for the HTTP exceptions the core used to throw:
 * the host decides how (or whether) to turn these into HTTP responses.
 */
export class PostingError extends Error {
  /** Machine-readable classification of the failure. */
  readonly code: ErrorCode;

  constructor(message: string, code: ErrorCode, options?: { cause?: unknown }) {
    super(message, options as ErrorOptions);
    this.name = new.target.name;
    this.code = code;
  }
}

/**
 * The request cannot be published as given. Never retryable: the same input
 * will fail the same way.
 */
export class ValidationError extends PostingError {
  /** Individual validation messages, when the failure has more than one cause. */
  readonly errors: string[];

  constructor(errors: string | string[], options?: { cause?: unknown }) {
    const list = Array.isArray(errors) ? errors : [errors];
    super(list.join('; '), ErrorCode.VALIDATION_ERROR, options);
    this.errors = list;
  }
}

/**
 * The operation was cancelled through an {@link AbortSignal} or because the
 * configured request timeout elapsed.
 */
export class AbortedError extends PostingError {
  constructor(message = 'Operation aborted', code: ErrorCode = ErrorCode.TIMEOUT_ERROR) {
    super(message, code);
  }
}
