import type { AuthValidation, IAuthValidator } from '@bozonx/social-posting/platform';
export const REQUIRED_SCOPES = ['write:statuses', 'write:media'] as const;
export class MastodonAuthValidator implements IAuthValidator {
  constructor(readonly providerName = 'mastodon') {}
  validate(auth: Record<string, unknown>): AuthValidation {
    const errors: string[] = [];
    if (typeof auth.accessToken !== 'string' || !auth.accessToken)
      errors.push("Mastodon auth requires an 'accessToken'");
    if (
      auth.scopes !== undefined &&
      (!Array.isArray(auth.scopes) ||
        !REQUIRED_SCOPES.every(scope => (auth.scopes as unknown[]).includes(scope)))
    )
      errors.push(`Mastodon publishing requires scopes: ${REQUIRED_SCOPES.join(', ')}`);
    return { errors };
  }
}
