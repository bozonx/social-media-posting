import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OAuth2TokenRefresher } from '../src/auth/oauth2.js';
import { StaticCredentialProvider, isAccessTokenExpired } from '../src/auth/credentials.js';
import { ErrorCode } from '../src/errors/error-code.js';
import type { CredentialProvider, ResolvedCredentials } from '../src/auth/credentials.js';
import type { PlatformError } from '../src/errors/platform-error.js';

const config = {
  tokenEndpoint: 'https://auth.example.com/token',
  clientId: 'client-1',
  clientSecret: 'secret',
};

function memoryProvider(initial: ResolvedCredentials): CredentialProvider & {
  stored: ResolvedCredentials[];
} {
  const stored: ResolvedCredentials[] = [];
  return {
    stored,
    getCredentials: async () => initial,
    onCredentialsRefreshed: async (_ref, next) => {
      stored.push(next);
    },
  };
}

function tokenResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const originalFetch = globalThis.fetch;

describe('isAccessTokenExpired', () => {
  it('treats credentials without an expiry as never expiring', () => {
    expect(isAccessTokenExpired({ accessToken: 't' })).toBe(false);
  });

  it('accepts both an ISO string and epoch milliseconds', () => {
    const soon = Date.now() + 10 * 60 * 1000;

    expect(isAccessTokenExpired({ expiresAt: soon })).toBe(false);
    expect(isAccessTokenExpired({ expiresAt: new Date(soon).toISOString() })).toBe(false);
  });

  it('expires a token early by the clock-skew margin', () => {
    const in30Seconds = Date.now() + 30_000;

    // A token that expires in 30s is treated as expired at a 60s margin: one
    // wasted refresh beats one failed publish.
    expect(isAccessTokenExpired({ expiresAt: in30Seconds }, 60)).toBe(true);
    expect(isAccessTokenExpired({ expiresAt: in30Seconds }, 10)).toBe(false);
  });

  it('ignores an unparseable expiry rather than refusing to publish', () => {
    expect(isAccessTokenExpired({ expiresAt: 'whenever' })).toBe(false);
  });
});

describe('StaticCredentialProvider', () => {
  it('returns credentials from configuration', async () => {
    const provider = new StaticCredentialProvider({ main: { apiKey: 'k' } });

    await expect(provider.getCredentials('main')).resolves.toEqual({ apiKey: 'k' });
  });

  it('fails loudly on an unknown account', async () => {
    const provider = new StaticCredentialProvider({});

    await expect(provider.getCredentials('nope')).rejects.toThrow(/not found/);
  });
});

describe('OAuth2TokenRefresher', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('leaves a valid token alone', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const credentials = { accessToken: 'good', expiresAt: Date.now() + 3_600_000 };
    const refresher = new OAuth2TokenRefresher(config, memoryProvider(credentials));

    await expect(refresher.ensureFresh('main', credentials)).resolves.toBe(credentials);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refreshes an expired token and hands the result back to the host', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        tokenResponse({ access_token: 'new', refresh_token: 'r2', expires_in: 3600 }),
      ) as unknown as typeof fetch;

    const provider = memoryProvider({ accessToken: 'old', refreshToken: 'r1', expiresAt: 1 });
    const refresher = new OAuth2TokenRefresher(config, provider);

    const result = await refresher.ensureFresh('main', {
      accessToken: 'old',
      refreshToken: 'r1',
      expiresAt: 1,
    });

    expect(result.accessToken).toBe('new');
    expect(result.refreshToken).toBe('r2');
    expect(result.expiresAt).toBeGreaterThan(Date.now());
    // A rotated refresh token that is not persisted locks the account out.
    expect(provider.stored).toEqual([expect.objectContaining({ refreshToken: 'r2' })]);
  });

  it('keeps the existing refresh token when the provider does not rotate it', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        tokenResponse({ access_token: 'new', expires_in: 60 }),
      ) as unknown as typeof fetch;

    const refresher = new OAuth2TokenRefresher(config, memoryProvider({}));

    const result = await refresher.refresh('main', { refreshToken: 'r1' });

    expect(result.refreshToken).toBe('r1');
  });

  it('sends the refresh_token grant with the client credentials', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(tokenResponse({ access_token: 'new' })) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;

    await new OAuth2TokenRefresher({ ...config, scopes: ['a', 'b'] }, memoryProvider({})).refresh(
      'main',
      { refreshToken: 'r1' },
    );

    const [url, init] = (fetchMock as unknown as { mock: { calls: [string, RequestInit][] } }).mock
      .calls[0];
    const body = new URLSearchParams(String(init.body));

    expect(url).toBe(config.tokenEndpoint);
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('r1');
    expect(body.get('client_id')).toBe('client-1');
    expect(body.get('client_secret')).toBe('secret');
    expect(body.get('scope')).toBe('a b');
  });

  it('collapses concurrent refreshes for one account into a single request', async () => {
    let resolveResponse: (value: Response) => void = () => {};
    const pending = new Promise<Response>(resolve => {
      resolveResponse = resolve;
    });
    const fetchMock = vi.fn().mockReturnValue(pending);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const refresher = new OAuth2TokenRefresher(config, memoryProvider({}));
    const credentials = { refreshToken: 'r1' };

    const first = refresher.refresh('main', credentials);
    const second = refresher.refresh('main', credentials);

    resolveResponse(tokenResponse({ access_token: 'new' }));
    const [a, b] = await Promise.all([first, second]);

    // With a rotating refresh token the second request would already be invalid.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  it('refreshes separate accounts independently', async () => {
    // A Response body can only be read once, so each call needs its own.
    const fetchMock = vi.fn(async () => tokenResponse({ access_token: 'new' }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const refresher = new OAuth2TokenRefresher(config, memoryProvider({}));
    await Promise.all([
      refresher.refresh('a', { refreshToken: 'r1' }),
      refresher.refresh('b', { refreshToken: 'r2' }),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('demands re-authorization when the refresh token is spent', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        tokenResponse({ error: 'invalid_grant', error_description: 'expired' }, 400),
      ) as unknown as typeof fetch;

    const refresher = new OAuth2TokenRefresher(config, memoryProvider({}));

    const error = (await refresher
      .refresh('main', { refreshToken: 'spent' })
      .catch((e: unknown) => e)) as PlatformError;

    expect(error.code).toBe(ErrorCode.AUTH_REFRESH_REQUIRED);
    expect(error.retryable).toBe(false);
    expect(error.platformCode).toBe('invalid_grant');
  });

  it('demands re-authorization when there is no refresh token at all', async () => {
    const refresher = new OAuth2TokenRefresher(config, memoryProvider({}));

    const error = (await refresher
      .refresh('main', { accessToken: 'expired' })
      .catch((e: unknown) => e)) as PlatformError;

    expect(error.code).toBe(ErrorCode.AUTH_REFRESH_REQUIRED);
  });

  it('treats a token endpoint outage as retryable', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(tokenResponse({ error: 'server_error' }, 503)) as unknown as typeof fetch;

    const refresher = new OAuth2TokenRefresher(config, memoryProvider({}));

    const error = (await refresher
      .refresh('main', { refreshToken: 'r1' })
      .catch((e: unknown) => e)) as PlatformError;

    expect(error.code).toBe(ErrorCode.AUTH_ERROR);
    expect(error.retryable).toBe(true);
  });

  it('allows a later refresh after one failed', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse({ error: 'server_error' }, 503))
      .mockResolvedValueOnce(tokenResponse({ access_token: 'new' })) as unknown as typeof fetch;

    const refresher = new OAuth2TokenRefresher(config, memoryProvider({}));

    await expect(refresher.refresh('main', { refreshToken: 'r1' })).rejects.toThrow();
    // The single-flight entry must not outlive the failure it belonged to.
    await expect(refresher.refresh('main', { refreshToken: 'r1' })).resolves.toMatchObject({
      accessToken: 'new',
    });
  });
});
