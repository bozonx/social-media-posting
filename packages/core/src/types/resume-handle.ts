/** Values that survive a round trip through JSON. */
export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/**
 * The state a multi-step publication reached before it failed.
 *
 * Publishing is rarely one call. Meta creates a container and then publishes it;
 * X runs INIT/APPEND/FINALIZE; LinkedIn registers an upload, PUTs the bytes and
 * then creates the post. If the third step fails and the host naively retries
 * the whole request, it uploads a second file and creates a second post.
 *
 * So a failure that left recoverable progress behind carries this handle, and
 * `publish(request, { resume })` continues from it instead of starting over.
 * It must stay JSON-serializable: the host stores it in its own job record.
 */
export interface ResumeHandle {
  /** Platform that produced the handle; another platform must refuse it. */
  platform: string;
  /** Platform-defined name of the step that was reached. */
  step: string;
  /** Platform-defined progress (upload id, container id, byte offset, …). */
  state: Record<string, JsonValue>;
  /** When the platform stops accepting the handle (ISO 8601), when it says so. */
  expiresAt?: string;
}
