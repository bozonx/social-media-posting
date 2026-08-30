import type { AuthValidation, IAuthValidator } from '@bozonx/social-posting/platform';

/**
 * Validates the shape of Tiktok credentials.
 *
 * Return `code: ErrorCode.AUTH_REFRESH_REQUIRED` for credentials that are
 * well-formed but spent, so the host re-authorizes instead of retrying forever.
 */
export class TiktokAuthValidator implements IAuthValidator {
  readonly providerName = 'tiktok';

  validate(auth: Record<string, unknown>): AuthValidation {
    const errors: string[] = [];

    if (typeof auth.accessToken !== 'string' || auth.accessToken.length === 0) {
      errors.push("Field 'accessToken' is required for Tiktok auth");
    }

    return { errors };
  }
}
