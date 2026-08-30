import type { AuthValidation, IAuthValidator } from '@bozonx/social-posting/platform';

export class BlueskyAuthValidator implements IAuthValidator {
  readonly providerName = 'bluesky';
  validate(auth: Record<string, unknown>): AuthValidation {
    const errors: string[] = [];
    if (typeof auth.accessToken !== 'string' || !auth.accessToken)
      errors.push("Field 'accessToken' is required for Bluesky auth");
    if (typeof auth.refreshToken !== 'string' || !auth.refreshToken)
      errors.push("Field 'refreshToken' is required for Bluesky auth");
    if (typeof auth.did !== 'string' || !auth.did.startsWith('did:'))
      errors.push("Field 'did' is required for Bluesky auth");
    return { errors };
  }
}
