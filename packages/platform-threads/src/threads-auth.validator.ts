import type { AuthValidation, IAuthValidator } from '@bozonx/social-posting/platform';
export const REQUIRED_SCOPES = ['threads_basic', 'threads_content_publish'] as const;
export class ThreadsAuthValidator implements IAuthValidator {
  readonly providerName = 'threads';
  validate(auth: Record<string, unknown>): AuthValidation {
    const errors: string[] = [];
    if (typeof auth.accessToken !== 'string' || !auth.accessToken)
      errors.push("Threads auth requires an 'accessToken'");
    if (
      auth.scopes !== undefined &&
      (!Array.isArray(auth.scopes) ||
        REQUIRED_SCOPES.some(s => !(auth.scopes as unknown[]).includes(s)))
    )
      errors.push(`Threads publishing requires scopes: ${REQUIRED_SCOPES.join(', ')}`);
    return { errors };
  }
}
