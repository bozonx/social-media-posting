/**
 * Credentials as a platform receives them.
 *
 * Static-token networks carry whatever key they use (`apiKey`); OAuth2 networks
 * carry an access token and the metadata needed to tell whether it is still
 * good. Extra fields pass through untouched.
 */
export interface ResolvedCredentials extends Record<string, unknown> {
  /** Bearer token for OAuth2 networks. */
  accessToken?: string;
  /** Refresh token, when the host stores one. */
  refreshToken?: string;
  /** When the access token stops working (ISO 8601 or epoch milliseconds). */
  expiresAt?: string | number;
  /** Scopes the access token was granted. */
  scopes?: string[];
}

/**
 * Where credentials come from, and where rotated ones go back to.
 *
 * This library never stores or encrypts a token: the host owns that, because
 * only the host has durable storage. What the library owns is the *mechanics*
 * of refreshing one — and when it does refresh, it hands the result straight
 * back through {@link onCredentialsRefreshed} so the host can persist it. A
 * refresh token that rotates and is not persisted locks the account out.
 */
export interface CredentialProvider {
  /**
   * Fetch current credentials for an account.
   * @param accountRef - The account name as it appears in a request.
   */
  getCredentials(accountRef: string): Promise<ResolvedCredentials>;

  /**
   * Persist credentials the library just refreshed.
   *
   * Optional only because static-token networks never call it. Any host serving
   * an OAuth2 network must implement it.
   *
   * @param accountRef - The account whose credentials rotated.
   * @param next - The credentials to store in place of the previous ones.
   */
  onCredentialsRefreshed?(accountRef: string, next: ResolvedCredentials): Promise<void>;
}

/**
 * The trivial provider: credentials that live in the client's own configuration
 * and never change.
 */
export class StaticCredentialProvider implements CredentialProvider {
  constructor(private readonly accounts: Record<string, ResolvedCredentials>) {}

  getCredentials(accountRef: string): Promise<ResolvedCredentials> {
    const credentials = this.accounts[accountRef];
    if (!credentials) {
      return Promise.reject(new Error(`Account "${accountRef}" not found in configuration`));
    }
    return Promise.resolve(credentials);
  }
}

/**
 * Whether an access token has expired, allowing for clocks that disagree.
 *
 * Treating a token as expired slightly early costs one refresh; treating an
 * expired one as valid costs a failed publish.
 *
 * @param credentials - Credentials to inspect.
 * @param clockSkewSecs - Safety margin, in seconds.
 * @param now - Current time, in epoch milliseconds.
 * @returns True when the token should be refreshed before use.
 */
export function isAccessTokenExpired(
  credentials: ResolvedCredentials,
  clockSkewSecs = 60,
  now = Date.now(),
): boolean {
  const { expiresAt } = credentials;
  if (expiresAt === undefined) {
    return false;
  }

  const expiryMs = typeof expiresAt === 'number' ? expiresAt : Date.parse(expiresAt);
  if (Number.isNaN(expiryMs)) {
    return false;
  }

  return expiryMs - clockSkewSecs * 1000 <= now;
}
