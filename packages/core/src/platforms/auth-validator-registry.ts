import { ErrorCode } from '../errors/error-code.js';
import { PlatformError } from '../errors/platform-error.js';
import { ValidationError } from '../errors/posting-error.js';
import type { AuthValidationContext, IAuthValidator } from './auth-validator.interface.js';

/**
 * Registry of platform-specific credential validators.
 */
export class AuthValidatorRegistry {
  private readonly validators = new Map<string, IAuthValidator>();

  /**
   * Register a validator, replacing any validator for the same platform.
   * @param validator - Auth validator instance.
   */
  register(validator: IAuthValidator): void {
    this.validators.set(validator.providerName.toLowerCase(), validator);
  }

  /**
   * Validate credentials for a platform. Platforms without a registered
   * validator are accepted as-is.
   *
   * @param platform - Platform name.
   * @param auth - Credentials to validate.
   * @param context - What the platform accepts, and which account this is.
   * @throws ValidationError for malformed credentials, or PlatformError with
   *   the code the validator asked for — `AUTH_REFRESH_REQUIRED` tells the host
   *   to send the user back through authorization instead of retrying.
   */
  async validate(
    platform: string,
    auth: Record<string, unknown>,
    context?: AuthValidationContext,
  ): Promise<void> {
    const validator = this.validators.get(platform.toLowerCase());
    if (!validator) {
      return;
    }

    const { errors, code } = await validator.validate(auth, context);
    if (errors.length === 0) {
      return;
    }

    if (code === undefined || code === ErrorCode.VALIDATION_ERROR) {
      throw new ValidationError(errors);
    }

    throw new PlatformError(errors.join('; '), code, {
      // Re-authorization needs a human; anything else the host may decide about.
      retryable: code !== ErrorCode.AUTH_REFRESH_REQUIRED && code !== ErrorCode.AUTH_ERROR,
    });
  }

  /**
   * Check whether a validator is registered for a platform.
   * @param platform - Platform name.
   */
  has(platform: string): boolean {
    return this.validators.has(platform.toLowerCase());
  }
}
