/**
 * Provider-specific validation of the shape of credentials.
 * Each platform decides what a well-formed credential object looks like.
 */
export interface IAuthValidator {
  /** Platform name this validator belongs to. */
  readonly providerName: string;

  /**
   * Validate a credential object.
   * @param auth - Credentials to validate.
   * @returns Error messages; an empty array means the credentials are well-formed.
   */
  validate(auth: Record<string, unknown>): string[];
}
