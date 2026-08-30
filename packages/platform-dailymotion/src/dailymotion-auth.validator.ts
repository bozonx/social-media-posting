import { ErrorCode, isAccessTokenExpired } from '@bozonx/social-posting';
import type { AuthValidation, IAuthValidator } from '@bozonx/social-posting/platform';

/** The scope an upload cannot happen without. */
export const MANAGE_VIDEOS_SCOPE = 'manage_videos';

/**
 * Validates the shape of Dailymotion credentials.
 *
 * Dailymotion access tokens expire, so the rule that earns its keep is the same
 * one as on YouTube: an account stored without a refresh token works until the
 * current token lapses and then needs a human, and saying so at configuration
 * time is cheaper than discovering it during a scheduled upload.
 */
export class DailymotionAuthValidator implements IAuthValidator {
  readonly providerName = 'dailymotion';

  validate(auth: Record<string, unknown>): AuthValidation {
    return validateDailymotionAuth(auth);
  }
}

/** Validate Dailymotion auth without constructing an adapter or performing I/O. */
export function validateDailymotionAuth(auth: Record<string, unknown>): AuthValidation {
  const errors: string[] = [];
  const { accessToken, refreshToken, scopes } = auth as {
    accessToken?: unknown;
    refreshToken?: unknown;
    scopes?: unknown;
  };

  if (accessToken === undefined || accessToken === null || accessToken === '') {
    errors.push("Dailymotion auth requires an 'accessToken'");
  } else if (typeof accessToken !== 'string') {
    errors.push("Field 'accessToken' must be a string");
  }

  if (refreshToken !== undefined && typeof refreshToken !== 'string') {
    errors.push("Field 'refreshToken' must be a string");
  }

  if (scopes !== undefined) {
    if (!Array.isArray(scopes) || scopes.some(scope => typeof scope !== 'string')) {
      errors.push("Field 'scopes' must be an array of strings");
    } else if (!scopes.includes(MANAGE_VIDEOS_SCOPE)) {
      errors.push(
        `Uploading requires the '${MANAGE_VIDEOS_SCOPE}' scope; this token was issued without it`,
      );
    }
  }

  if (errors.length === 0 && refreshToken === undefined && isAccessTokenExpired(auth)) {
    return {
      errors: [
        'The Dailymotion access token has expired and the account carries no refresh token; the channel must be authorized again',
      ],
      code: ErrorCode.AUTH_REFRESH_REQUIRED,
    };
  }

  return { errors };
}
