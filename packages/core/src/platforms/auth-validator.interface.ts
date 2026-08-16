import type { ErrorCode } from '../errors/error-code.js';
import type { PlatformCapabilities } from './capabilities.js';

/** What a credential check found. */
export interface AuthValidation {
  /** Problems with the credentials; empty means they are usable. */
  errors: string[];
  /**
   * How the failure should surface.
   *
   * Defaults to `VALIDATION_ERROR` — credentials that are the wrong shape.
   * A validator returns `AUTH_REFRESH_REQUIRED` when the credentials are
   * well-formed but spent, so the host flags the channel for re-authorization
   * rather than queueing a retry that can never succeed.
   */
  code?: ErrorCode;
}

/** What a validator knows about the call it is checking. */
export interface AuthValidationContext {
  /** What the platform accepts, in case the check depends on it. */
  capabilities: PlatformCapabilities;
  /** The named account the credentials came from, when there was one. */
  accountRef?: string;
}

/**
 * Provider-specific validation of credentials.
 *
 * Asynchronous because a network with expiring tokens may have to consult the
 * host's credential provider to answer "is this token still good?", which a
 * synchronous string check cannot do.
 */
export interface IAuthValidator {
  /** Platform name this validator belongs to. */
  readonly providerName: string;

  /**
   * Validate a credential object.
   * @param auth - Credentials to validate.
   * @param context - What the platform accepts, and which account this is.
   * @returns The problems found, and how they should surface.
   */
  validate(
    auth: Record<string, unknown>,
    context?: AuthValidationContext,
  ): Promise<AuthValidation> | AuthValidation;
}
