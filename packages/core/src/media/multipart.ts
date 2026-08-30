import { ErrorCode } from '../errors/error-code.js';
import { PlatformError } from '../errors/platform-error.js';
import { httpRequest } from '../http/http-request.js';
import type { JsonValue, ResumeHandle } from '../types/resume-handle.js';

/** One part of a multipart body. */
export type MultipartPart =
  | { name: string; value: string }
  | {
      name: string;
      /** File contents. A stream cannot be used here: `FormData` needs a length. */
      content: Uint8Array | Blob;
      fileName?: string;
      contentType?: string;
    };

/**
 * Build a `multipart/form-data` body from Web APIs alone.
 *
 * No `form-data` package, no `Buffer`: the result is a `FormData` that `fetch`
 * serializes itself, which is what keeps this working on Workers and Deno as
 * well as Node. Let `fetch` set the `Content-Type`; a hand-written boundary is
 * the usual way this goes wrong.
 *
 * @param parts - Fields and files, in the order the platform expects them.
 * @returns A `FormData` ready to pass as a request body.
 */
export function buildMultipartFormData(parts: MultipartPart[]): FormData {
  const form = new FormData();

  for (const part of parts) {
    if ('value' in part) {
      form.append(part.name, part.value);
      continue;
    }

    const blob =
      part.content instanceof Blob
        ? part.content
        : new Blob([part.content as unknown as BlobPart], {
            type: part.contentType ?? 'application/octet-stream',
          });

    if (part.fileName !== undefined) {
      form.append(part.name, blob, part.fileName);
    } else {
      form.append(part.name, blob);
    }
  }

  return form;
}

/** One upload that sends the whole file in a single request. */
export interface SinglePartUploadOptions {
  /** Where the bytes go. */
  url: string;
  /** `PUT` for pre-signed targets, `POST` for form endpoints. Default: `PUT`. */
  method?: 'PUT' | 'POST';
  /** The bytes, or a `FormData` from {@link buildMultipartFormData}. */
  body: Uint8Array | Blob | FormData | ReadableStream<Uint8Array>;
  headers?: Record<string, string>;
  /** Total size, when known; sent as `Content-Length` where the runtime allows. */
  totalBytes?: number;
  signal?: AbortSignal;
  fetch?: typeof fetch;
}

/**
 * Send a whole file in one request.
 *
 * The counterpart to {@link runChunkedUpload} for the many networks whose
 * upload is a single `PUT` to a pre-signed URL. It is never retried here: only
 * the caller knows whether the target accepts the same bytes twice.
 *
 * @param options - Target, body and headers.
 * @returns The platform's response, whatever its status.
 */
export async function runSinglePartUpload(options: SinglePartUploadOptions): Promise<Response> {
  const headers: Record<string, string> = { ...options.headers };
  if (options.totalBytes !== undefined && headers['content-length'] === undefined) {
    headers['content-length'] = String(options.totalBytes);
  }

  return httpRequest(options.url, {
    method: options.method ?? 'PUT',
    headers,
    body: options.body as BodyInit,
    // A stream cannot be replayed, and a mutating upload must not be repeated
    // blind in any case.
    replayableBody: false,
    signal: options.signal,
    fetch: options.fetch,
  });
}

/** The step names the generic upload sequence records in a resume handle. */
export const UPLOAD_SEQUENCE_STEPS = {
  INIT: 'init',
  UPLOAD: 'upload',
  FINALIZE: 'finalize',
  STATUS: 'status',
} as const;

export type UploadSequenceStep = (typeof UPLOAD_SEQUENCE_STEPS)[keyof typeof UPLOAD_SEQUENCE_STEPS];

/**
 * The four steps nearly every upload API is built from.
 *
 * Each is separate so a failure names the step it failed at, and a resume picks
 * up from that step instead of from the beginning.
 */
export interface UploadSequence<TSession, TResult> {
  /** Open the session. Safe to repeat until it has returned an id. */
  init(signal?: AbortSignal): Promise<TSession>;
  /** Move the bytes: chunked, single-part or multipart — the adapter decides. */
  upload(session: TSession, signal?: AbortSignal): Promise<void>;
  /** Tell the platform the bytes are all there. */
  finalize(session: TSession, signal?: AbortSignal): Promise<TResult>;
  /** Optional post-finalize wait for platforms that transcode. */
  status?(session: TSession, signal?: AbortSignal): Promise<TResult>;
  /** Render the session as JSON. Must contain no secrets. */
  serializeSession(session: TSession): Record<string, JsonValue>;
  /** Rebuild the session from a resume handle. */
  deserializeSession(state: Record<string, JsonValue>): TSession;
}

/** Knobs for one run of {@link runUploadSequence}. */
export interface UploadSequenceOptions {
  /** Platform name, stamped into any resume handle. */
  platform: string;
  /** Handle from a previous attempt; the run continues from its step. */
  resume?: ResumeHandle;
  signal?: AbortSignal;
}

/**
 * Run init → upload → finalize → status, resuming from wherever a previous
 * attempt stopped.
 *
 * Every failure carries a handle naming the step reached, so the retry after it
 * repeats one step rather than the whole publication.
 *
 * @param sequence - The platform's four steps.
 * @param options - Platform name, resume handle, abort signal.
 * @returns Whatever `finalize()` (or `status()`) returned.
 */
export async function runUploadSequence<TSession, TResult>(
  sequence: UploadSequence<TSession, TResult>,
  options: UploadSequenceOptions,
): Promise<TResult> {
  const resumed = options.resume?.platform === options.platform ? options.resume : undefined;

  let step: UploadSequenceStep =
    (resumed?.step as UploadSequenceStep | undefined) ?? UPLOAD_SEQUENCE_STEPS.INIT;
  let session: TSession;

  const handleAt = (at: UploadSequenceStep, current: TSession): ResumeHandle => ({
    platform: options.platform,
    step: at,
    state: sequence.serializeSession(current),
  });

  try {
    if (resumed && step !== UPLOAD_SEQUENCE_STEPS.INIT) {
      session = sequence.deserializeSession(resumed.state);
    } else {
      session = await sequence.init(options.signal);
      step = UPLOAD_SEQUENCE_STEPS.UPLOAD;
    }
  } catch (error) {
    throw asPlatformError(error);
  }

  try {
    if (step === UPLOAD_SEQUENCE_STEPS.UPLOAD) {
      await sequence.upload(session, options.signal);
      step = UPLOAD_SEQUENCE_STEPS.FINALIZE;
    }

    let result: TResult;
    if (step === UPLOAD_SEQUENCE_STEPS.FINALIZE) {
      result = await sequence.finalize(session, options.signal);
      step = UPLOAD_SEQUENCE_STEPS.STATUS;
    } else {
      result = await requireStatus(sequence)(session, options.signal);
    }

    if (sequence.status) {
      return await sequence.status(session, options.signal);
    }
    return result;
  } catch (error) {
    throw attachHandle(error, handleAt(step, session));
  }
}

function requireStatus<TSession, TResult>(
  sequence: UploadSequence<TSession, TResult>,
): (session: TSession, signal?: AbortSignal) => Promise<TResult> {
  if (!sequence.status) {
    throw new PlatformError(
      'Resume handle points at the status step, but this upload has none',
      ErrorCode.VALIDATION_ERROR,
      { retryable: false },
    );
  }
  return sequence.status.bind(sequence);
}

function asPlatformError(error: unknown): PlatformError {
  if (error instanceof PlatformError) {
    return error;
  }
  return new PlatformError(
    error instanceof Error ? error.message : 'Upload failed',
    ErrorCode.PLATFORM_ERROR,
    { retryable: true, cause: error },
  );
}

function attachHandle(error: unknown, resumeHandle: ResumeHandle): PlatformError {
  const platformError = asPlatformError(error);
  if (platformError.resumeHandle) {
    return platformError;
  }
  return new PlatformError(platformError.message, platformError.code, {
    retryable: platformError.retryable,
    retryAfterMs: platformError.retryAfterMs,
    httpStatus: platformError.httpStatus,
    platformCode: platformError.platformCode,
    outcomeUnknown: platformError.outcomeUnknown,
    cause: platformError.cause ?? platformError,
    raw: platformError.raw,
    resumeHandle,
  });
}
