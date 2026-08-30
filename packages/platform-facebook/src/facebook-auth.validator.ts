import type { AuthValidation, IAuthValidator } from '@bozonx/social-posting/platform';
export const REQUIRED_SCOPES = ['pages_manage_posts', 'pages_read_engagement'] as const;
export class FacebookAuthValidator implements IAuthValidator {
  readonly providerName = 'facebook';
  validate(auth: Record<string, unknown>): AuthValidation {
    const errors: string[] = [];
    if (typeof auth.accessToken !== 'string' || !auth.accessToken)
      errors.push("Facebook Page auth requires an 'accessToken'");
    if (
      auth.scopes !== undefined &&
      (!Array.isArray(auth.scopes) ||
        REQUIRED_SCOPES.some(s => !(auth.scopes as unknown[]).includes(s)))
    )
      errors.push(`Facebook Page publishing requires scopes: ${REQUIRED_SCOPES.join(', ')}`);
    return { errors };
  }
}
