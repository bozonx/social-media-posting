/**
 * Where on a platform a publication goes.
 *
 * A single id is enough for Telegram (a chat) and Mastodon (the account), but
 * not for Pinterest (board + section) or a forum (community + topic). So the
 * address is structural, and the extra parts a network needs are declared in
 * `capabilities.targetSchema` exactly like `extra` fields are.
 */
export interface PlatformTarget {
  /** Primary platform-native identifier. */
  id: string;
  /** Further parts of a composite address, described by `capabilities.targetSchema`. */
  [key: string]: unknown;
}

/**
 * What a caller may pass.
 *
 * A scalar is shorthand for networks with a single identifier — not a
 * compatibility shim. The core normalizes it into `{ id: String(value) }`
 * before any adapter sees it, so an adapter only ever handles
 * {@link PlatformTarget}.
 */
export type TargetInput = string | number | PlatformTarget;

/**
 * Normalize a caller-supplied target into the one shape adapters see.
 *
 * @param input - Scalar shorthand or a structural target.
 * @returns The normalized target, or undefined when nothing was supplied.
 */
export function normalizeTarget(input: TargetInput | undefined): PlatformTarget | undefined {
  if (input === undefined) {
    return undefined;
  }
  if (typeof input === 'string' || typeof input === 'number') {
    const id = String(input);
    return id.length > 0 ? { id } : undefined;
  }
  if (typeof input !== 'object' || Array.isArray(input)) {
    return undefined;
  }
  const { id, ...rest } = input;
  if (typeof id !== 'string' || id.trim().length === 0) {
    return undefined;
  }
  return { id, ...rest };
}

/**
 * Whether a value is shaped like a target at all, for structural validation.
 * @param input - The candidate value.
 */
export function isValidTargetInput(input: unknown): input is TargetInput {
  if (typeof input === 'string') {
    return input.trim().length > 0;
  }
  if (typeof input === 'number') {
    // Identifiers are whole numbers; a fractional one is a mistake upstream.
    return Number.isInteger(input);
  }
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return false;
  }
  const { id } = input as { id?: unknown };
  return typeof id === 'string' && id.trim().length > 0;
}
