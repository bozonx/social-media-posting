import type { AuthValidation, IAuthValidator } from '@bozonx/social-posting/platform';

/**
 * Validates the shape of Linkedin credentials.
 *
 * Return `code: ErrorCode.AUTH_REFRESH_REQUIRED` for credentials that are
 * well-formed but spent, so the host re-authorizes instead of retrying forever.
 */
export class LinkedinAuthValidator implements IAuthValidator {
  readonly providerName = 'linkedin';

  validate(auth: Record<string, unknown>): AuthValidation {
    const errors: string[] = [];

    if (typeof auth.accessToken !== 'string' || auth.accessToken.length === 0) {
      errors.push("Field 'accessToken' is required for Linkedin auth");
    }

    return { errors };
  }
}
