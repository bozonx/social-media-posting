import { ErrorCode } from '../errors/error-code.js';
import { PlatformError } from '../errors/platform-error.js';
import { httpRequest } from '../http/http-request.js';
import { isAccessTokenExpired } from './credentials.js';
import type { CredentialProvider, ResolvedCredentials } from './credentials.js';
import type { ResolvedAccountConfig } from '../types/account-config.js';

/**
 * How a platform's OAuth2 configuration is obtained.
 *
 * A function, not a constant, because on Mastodon and Pixelfed the client id
 * and secret are issued per instance: they belong to the account, not to the
 * package. Networks with one set of app credentials pass a plain object.
 */
export type OAuth2ConfigSource =
  OAuth2Config | ((accountConfig: ResolvedAccountConfig) => OAuth2Config);

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
    private readonly configSource: OAuth2ConfigSource,
    private readonly credentialProvider: CredentialProvider,
  ) {}

  /** The configuration for one account, resolved per call. */
  private configFor(accountConfig?: ResolvedAccountConfig): OAuth2Config {
    if (typeof this.configSource !== 'function') {
      return this.configSource;
    }
    if (!accountConfig) {
      throw new PlatformError(
        'This platform builds its OAuth2 configuration from the account, so the account must be passed to the refresher',
        ErrorCode.AUTH_ERROR,
        { retryable: false },
      );
    }
    return this.configSource(accountConfig);
  }

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
    accountConfig?: ResolvedAccountConfig,
  ): Promise<ResolvedCredentials> {
    const config = this.configFor(accountConfig);
    if (!isAccessTokenExpired(credentials, config.clockSkewSecs ?? 60)) {
      return credentials;
    }
    return this.refresh(accountRef, credentials, signal, accountConfig);
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
    accountConfig?: ResolvedAccountConfig,
  ): Promise<ResolvedCredentials> {
    const pending = this.inFlight.get(accountRef);
    if (pending) {
      return pending;
    }

    const promise = this.performRefresh(accountRef, credentials, signal, accountConfig).finally(
      () => {
        this.inFlight.delete(accountRef);
      },
    );
    this.inFlight.set(accountRef, promise);
    return promise;
  }

  private async performRefresh(
    accountRef: string,
    credentials: ResolvedCredentials,
    signal?: AbortSignal,
    accountConfig?: ResolvedAccountConfig,
  ): Promise<ResolvedCredentials> {
    const config = this.configFor(accountConfig);
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
      client_id: config.clientId,
    });
    if (config.clientSecret) {
      body.set('client_secret', config.clientSecret);
    }
    if (config.scopes?.length) {
      body.set('scope', config.scopes.join(' '));
    }

    const response = await httpRequest(config.tokenEndpoint, {
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

/** An application registration on a per-instance network. */
export interface AppRegistrationRequest {
  /** Instance base URL, e.g. `https://mastodon.social`. */
  apiBaseUrl: string;
  clientName: string;
  redirectUris: string[];
  scopes?: string[];
  website?: string;
}

/**
 * Build the request that registers an application on one instance.
 *
 * Mastodon-family instances issue client credentials per instance
 * (`POST /api/v1/apps`), so a host adding a new instance must register first
 * and then persist what comes back **alongside the tokens** — the credentials
 * are account state, not package constants.
 *
 * Only the request is built here: performing it and storing the answer is the
 * host's, because only the host has storage and a redirect endpoint.
 *
 * @param request - Instance URL and the app's identity.
 * @returns URL and init for `fetch`.
 */
export function buildAppRegistrationRequest(request: AppRegistrationRequest): {
  url: string;
  init: RequestInit;
} {
  const base = request.apiBaseUrl.replace(/\/+$/, '');
  const body = new URLSearchParams({
    client_name: request.clientName,
    redirect_uris: request.redirectUris.join(' '),
  });
  if (request.scopes?.length) {
    body.set('scopes', request.scopes.join(' '));
  }
  if (request.website) {
    body.set('website', request.website);
  }

  return {
    url: `${base}/api/v1/apps`,
    init: {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body: body.toString(),
    },
  };
}
