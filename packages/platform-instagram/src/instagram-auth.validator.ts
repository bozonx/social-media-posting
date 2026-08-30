import type { AuthValidation, IAuthValidator } from '@bozonx/social-posting/platform';
export const REQUIRED_SCOPES = ['instagram_basic', 'instagram_content_publish'] as const;
export class InstagramAuthValidator implements IAuthValidator {
  readonly providerName = 'instagram';
  validate(auth: Record<string, unknown>): AuthValidation {
    const errors: string[] = [];
    if (typeof auth.accessToken !== 'string' || !auth.accessToken)
      errors.push("Instagram auth requires an 'accessToken'");
    if (
      auth.scopes !== undefined &&
      (!Array.isArray(auth.scopes) ||
        REQUIRED_SCOPES.some(s => !(auth.scopes as unknown[]).includes(s)))
    )
      errors.push(`Instagram publishing requires scopes: ${REQUIRED_SCOPES.join(', ')}`);
    return { errors };
  }
}
