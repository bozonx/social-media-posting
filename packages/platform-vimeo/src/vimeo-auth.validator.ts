import type { AuthValidation, IAuthValidator } from '@bozonx/social-posting/platform';

/** The scope an upload cannot happen without. */
export const UPLOAD_SCOPE = 'upload';

/**
 * Validates the shape of Vimeo credentials.
 *
 * Vimeo access tokens do not expire on a clock, so there is no refresh token to
 * insist on here — the failure mode this validator guards against is the other
 * one: a token minted without the `upload` scope, which authenticates perfectly
 * and then refuses every upload with a 403.
 */
export class VimeoAuthValidator implements IAuthValidator {
  readonly providerName = 'vimeo';

  validate(auth: Record<string, unknown>): AuthValidation {
    return validateVimeoAuth(auth);
  }
}

/** Validate Vimeo auth without constructing an adapter or performing I/O. */
export function validateVimeoAuth(auth: Record<string, unknown>): AuthValidation {
  const errors: string[] = [];
  const { accessToken, scopes } = auth as { accessToken?: unknown; scopes?: unknown };

  if (accessToken === undefined || accessToken === null || accessToken === '') {
    errors.push("Vimeo auth requires an 'accessToken'");
  } else if (typeof accessToken !== 'string') {
    errors.push("Field 'accessToken' must be a string");
  }

  if (scopes !== undefined) {
    if (!Array.isArray(scopes) || scopes.some(scope => typeof scope !== 'string')) {
      errors.push("Field 'scopes' must be an array of strings");
    } else if (!scopes.includes(UPLOAD_SCOPE)) {
      errors.push(
        `Uploading requires the '${UPLOAD_SCOPE}' scope; this token was issued without it and every upload will be refused`,
      );
    }
  }

  return { errors };
}
