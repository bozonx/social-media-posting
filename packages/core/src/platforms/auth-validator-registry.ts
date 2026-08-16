import type { IAuthValidator } from './auth-validator.interface.js';
import { ValidationError } from '../errors/posting-error.js';

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
   * @param platform - Platform name.
   * @param auth - Credentials to validate.
   * @throws ValidationError if the credentials are malformed.
   */
  validate(platform: string, auth: Record<string, unknown>): void {
    const validator = this.validators.get(platform.toLowerCase());
    if (!validator) {
      return;
    }

    const errors = validator.validate(auth);
    if (errors.length > 0) {
      throw new ValidationError(errors);
    }
  }

  /**
   * Check whether a validator is registered for a platform.
   * @param platform - Platform name.
   */
  has(platform: string): boolean {
    return this.validators.has(platform.toLowerCase());
  }
}
