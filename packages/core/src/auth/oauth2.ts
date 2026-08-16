import { ErrorCode } from '../errors/error-code.js';
import { PlatformError } from '../errors/platform-error.js';
import { httpRequest } from '../http/http-request.js';
import { isAccessTokenExpired } from './credentials.js';
import type { CredentialProvider, ResolvedCredentials } from './credentials.js';

/** What a platform must state to have its tokens refreshed. */
export interface OAuth2Config {
  /** The network's token endpoint. */
  tokenEndpoint: string;
  /** OAuth2 client identifier issued to the host application. */
  clientId: string;
  /** Client secret, for networks using `client_secret_post`. */
  clientSecret?: string;
  /** Scopes to request alongside the refresh. */
  scopes?: string[];
  /** Safety margin for clock disagreement, in seconds (default: 60). */
  clockSkewSecs?: number;
}

/** The token response shape RFC 6749 defines. */
interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

/**
 * Refreshes OAuth2 access tokens on behalf of a platform.
 *
 * Two things make this worth having in one place rather than per network:
 *
 * - **Clock skew.** A token that expires "now" has usually expired already.
 * - **Single flight.** Two posts to the same account starting at once must not
 *   fire two refreshes: with rotating refresh tokens the second one is invalid
 *   by the time it is sent, and the account is locked out.
 *
 * The authorization-code redirect is *not* here — that is a web flow, and it
 * belongs to the host's application. See `docs/OAUTH.md`.
 */
export class OAuth2TokenRefresher {
  private readonly inFlight = new Map<string, Promise<ResolvedCredentials>>();

  constructor(
    private readonly config: OAuth2Config,
    private readonly credentialProvider: CredentialProvider,
  ) {}

  /**
   * Return credentials that are good to use, refreshing first if they are not.
   *
   * @param accountRef - The account the credentials belong to.
   * @param credentials - The credentials as stored.
   * @param signal - Aborts the refresh request.
   * @returns Credentials with a valid access token.
   * @throws PlatformError with `AUTH_REFRESH_REQUIRED` when only a human can fix it.
   */
  async ensureFresh(
    accountRef: string,
    credentials: ResolvedCredentials,
    signal?: AbortSignal,
  ): Promise<ResolvedCredentials> {
    if (!isAccessTokenExpired(credentials, this.config.clockSkewSecs ?? 60)) {
      return credentials;
    }
    return this.refresh(accountRef, credentials, signal);
  }

  /**
   * Refresh an account's access token, collapsing concurrent calls for the same
   * account into a single request.
   *
   * @param accountRef - The account the credentials belong to.
   * @param credentials - The credentials as stored.
   * @param signal - Aborts the refresh request.
   * @returns The refreshed credentials, already handed to the provider to persist.
   */
  async refresh(
    accountRef: string,
    credentials: ResolvedCredentials,
    signal?: AbortSignal,
  ): Promise<ResolvedCredentials> {
    const pending = this.inFlight.get(accountRef);
    if (pending) {
      return pending;
    }

    const promise = this.performRefresh(accountRef, credentials, signal).finally(() => {
      this.inFlight.delete(accountRef);
    });
    this.inFlight.set(accountRef, promise);
    return promise;
  }

  private async performRefresh(
    accountRef: string,
    credentials: ResolvedCredentials,
    signal?: AbortSignal,
  ): Promise<ResolvedCredentials> {
    const refreshToken = credentials.refreshToken;
    if (typeof refreshToken !== 'string' || refreshToken.length === 0) {
      throw new PlatformError(
        `Account "${accountRef}" has an expired access token and no refresh token`,
        ErrorCode.AUTH_REFRESH_REQUIRED,
        { retryable: false },
      );
    }

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: this.config.clientId,
    });
    if (this.config.clientSecret) {
      body.set('client_secret', this.config.clientSecret);
    }
    if (this.config.scopes?.length) {
      body.set('scope', this.config.scopes.join(' '));
    }

    const response = await httpRequest(this.config.tokenEndpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body: body.toString(),
      signal,
    });

    const payload = (await response.json().catch(() => ({}))) as TokenResponse;

    if (!response.ok || !payload.access_token) {
      throw refreshFailure(accountRef, response.status, payload);
    }

    const next: ResolvedCredentials = {
      ...credentials,
      accessToken: payload.access_token,
      // Rotating providers issue a new refresh token on every use; keeping the
      // old one when they do is how an account silently locks itself out.
      refreshToken: payload.refresh_token ?? refreshToken,
      expiresAt:
        payload.expires_in === undefined
          ? credentials.expiresAt
          : Date.now() + payload.expires_in * 1000,
      scopes: payload.scope ? payload.scope.split(' ') : credentials.scopes,
    };

    await this.credentialProvider.onCredentialsRefreshed?.(accountRef, next);

    return next;
  }
}

/**
 * Classify a failed refresh.
 *
 * `invalid_grant` means the refresh token is spent or revoked: no amount of
 * retrying helps, and the host must send the user back through authorization.
 */
function refreshFailure(accountRef: string, status: number, payload: TokenResponse): PlatformError {
  const description = payload.error_description ?? payload.error ?? `token endpoint said ${status}`;
  const unrecoverable =
    payload.error === 'invalid_grant' ||
    payload.error === 'invalid_client' ||
    status === 400 ||
    status === 401;

  return new PlatformError(
    `Refreshing credentials for "${accountRef}" failed: ${description}`,
    unrecoverable ? ErrorCode.AUTH_REFRESH_REQUIRED : ErrorCode.AUTH_ERROR,
    {
      retryable: !unrecoverable,
      httpStatus: status,
      platformCode: payload.error,
    },
  );
}
