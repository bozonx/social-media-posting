import { ErrorCode, isAccessTokenExpired } from '@bozonx/social-posting';
import type { AuthValidation, IAuthValidator } from '@bozonx/social-posting/platform';

/**
 * Scopes an upload needs.
 *
 * `youtube.upload` alone is enough to insert a video; `youtube` is needed to
 * read back its processing status and to set a custom thumbnail.
 */
export const UPLOAD_SCOPE = 'https://www.googleapis.com/auth/youtube.upload';
export const MANAGE_SCOPE = 'https://www.googleapis.com/auth/youtube';
export const READONLY_SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';

/**
 * Validates the shape of YouTube credentials.
 *
 * The rule that matters beyond "is there a token" is the refresh token: a
 * Google access token lives one hour, and an account stored without a refresh
 * token works for exactly that hour and then needs a human. Saying so at
 * configuration time is cheaper than discovering it during a scheduled upload.
 */
export class YouTubeAuthValidator implements IAuthValidator {
  readonly providerName = 'youtube';

  validate(auth: Record<string, unknown>): AuthValidation {
    return validateYouTubeAuth(auth);
  }
}

/** Validate YouTube auth without constructing an adapter or performing I/O. */
export function validateYouTubeAuth(auth: Record<string, unknown>): AuthValidation {
  const errors: string[] = [];
  const { accessToken, refreshToken, scopes } = auth as {
    accessToken?: unknown;
    refreshToken?: unknown;
    scopes?: unknown;
  };

  if (accessToken === undefined || accessToken === null || accessToken === '') {
    errors.push("YouTube auth requires an 'accessToken'");
  } else if (typeof accessToken !== 'string') {
    errors.push("Field 'accessToken' must be a string");
  }

  if (refreshToken !== undefined && typeof refreshToken !== 'string') {
    errors.push("Field 'refreshToken' must be a string");
  }

  if (scopes !== undefined) {
    if (!Array.isArray(scopes) || scopes.some(scope => typeof scope !== 'string')) {
      errors.push("Field 'scopes' must be an array of strings");
    } else if (!scopes.includes(UPLOAD_SCOPE) && !scopes.includes(MANAGE_SCOPE)) {
      errors.push(
        `Uploading requires the '${UPLOAD_SCOPE}' or '${MANAGE_SCOPE}' scope; this account carries neither`,
      );
    }
  }

  // A well-formed but spent credential is not a malformed one. Reported as
  // `AUTH_REFRESH_REQUIRED` so the host sends the user back through consent
  // instead of queueing a retry that can never succeed: a Google access token
  // lives about an hour, and without a refresh token that hour is the whole
  // life of the account.
  if (errors.length === 0 && refreshToken === undefined && isAccessTokenExpired(auth)) {
    return {
      errors: [
        'The YouTube access token has expired and the account carries no refresh token; the channel must be authorized again',
      ],
      code: ErrorCode.AUTH_REFRESH_REQUIRED,
    };
  }

  return { errors };
}
