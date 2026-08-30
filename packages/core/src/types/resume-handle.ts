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
 *
 * Two rules make it usable by a host that stores it in a job row:
 *
 * - it is JSON and nothing but JSON, so it survives a process restart;
 * - it carries **no secrets** — no access token, no signed upload URL, no
 *   authorization header. Those are re-derived from the account on resume.
 */
export interface ResumeHandle {
  /**
   * Serialization format version. Hosts must retain it with the handle and
   * adapters must reject versions they do not understand instead of silently
   * interpreting old progress as current state.
   */
  version?: 1;
  /** Platform that produced the handle; another platform must refuse it. */
  platform: string;
  /** Platform-defined name of the step that was reached. */
  step: string;
  /** Platform-defined progress (upload id, container id, byte offset, …). */
  state: Record<string, JsonValue>;
  /** When the platform stops accepting the handle (ISO 8601), when it says so. */
  expiresAt?: string;
}

/** Keys whose values are secrets by name alone. */
const SECRET_KEY_PATTERN =
  /(token|secret|password|passwd|credential|authorization|auth$|apikey|api_key|bearer|cookie|signature|signed|private_?key)/i;

/** Keys naming a URL that a platform pre-signed, which is a bearer secret in disguise. */
const URL_KEY_PATTERN = /(uploadurl|upload_url|sessionurl|session_url|resumableurl|presigned)/i;

/** Values that are recognisably a credential regardless of their key. */
function looksLikeSecretValue(value: JsonValue): boolean {
  if (typeof value !== 'string') {
    return false;
  }
  if (/^bearer\s+\S+/i.test(value)) {
    return true;
  }
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      for (const key of url.searchParams.keys()) {
        if (SECRET_KEY_PATTERN.test(key)) {
          return true;
        }
      }
    } catch {
      return false;
    }
  }
  return false;
}

/** One offending path inside a handle. */
export interface ResumeHandleViolation {
  /** Dotted path within `state`, e.g. `session.uploadUrl`. */
  path: string;
  reason: 'secretKey' | 'secretValue';
}

/**
 * Find everything in a handle that must never be persisted by a host.
 *
 * @param handle - The handle a platform produced.
 * @returns Offending paths; an empty array means the handle is safe to store.
 */
export function findResumeHandleSecrets(handle: ResumeHandle): ResumeHandleViolation[] {
  const violations: ResumeHandleViolation[] = [];

  const walk = (value: JsonValue, path: string): void => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }
    if (value !== null && typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) {
        const childPath = path ? `${path}.${key}` : key;
        if (SECRET_KEY_PATTERN.test(key) || URL_KEY_PATTERN.test(key)) {
          violations.push({ path: childPath, reason: 'secretKey' });
          continue;
        }
        walk(item, childPath);
      }
      return;
    }
    if (looksLikeSecretValue(value)) {
      violations.push({ path, reason: 'secretValue' });
    }
  };

  walk(handle.state, '');
  return violations;
}

/** How a handle is checked before it leaves the library. */
export interface ResumeHandleGuardOptions {
  /**
   * Throw instead of stripping. Meant for development and test runs, where an
   * adapter leaking a token must fail loudly rather than quietly work.
   */
  strict?: boolean;
  /** Called once per stripped path in non-strict mode. */
  onViolation?: (violation: ResumeHandleViolation) => void;
}

/**
 * Return a handle with any secret removed.
 *
 * @param handle - The handle a platform produced.
 * @param options - Strict mode and a warning sink.
 * @returns The handle, with offending entries deleted.
 * @throws Error in strict mode when the handle carries a secret.
 */
export function sanitizeResumeHandle(
  handle: ResumeHandle,
  options: ResumeHandleGuardOptions = {},
): ResumeHandle {
  const violations = findResumeHandleSecrets(handle);
  if (violations.length === 0) {
    return handle;
  }

  if (options.strict) {
    throw new Error(
      `Resume handle for "${handle.platform}" carries secrets at: ${violations
        .map(v => v.path)
        .join(
          ', ',
        )}. A handle must be re-usable from storage alone; derive credentials from the account instead.`,
    );
  }

  const clone = JSON.parse(JSON.stringify(handle)) as ResumeHandle;
  for (const violation of violations) {
    options.onViolation?.(violation);
    deletePath(clone.state, violation.path);
  }
  return clone;
}

function deletePath(root: JsonValue, path: string): void {
  const segments = path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(segment => segment.length > 0);
  let current: JsonValue = root;
  for (let i = 0; i < segments.length - 1; i++) {
    if (current === null || typeof current !== 'object') {
      return;
    }
    current = (current as Record<string, JsonValue>)[segments[i] as string] as JsonValue;
  }
  const last = segments[segments.length - 1];
  if (last !== undefined && current !== null && typeof current === 'object') {
    delete (current as Record<string, JsonValue>)[last];
  }
}
