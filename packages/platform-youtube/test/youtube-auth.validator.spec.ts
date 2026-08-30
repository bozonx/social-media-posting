import { describe, expect, it } from 'vitest';
import { ErrorCode } from '@bozonx/social-posting';
import { MANAGE_SCOPE, UPLOAD_SCOPE, validateYouTubeAuth } from '../src/youtube-auth.validator.js';

describe('validateYouTubeAuth', () => {
  it('accepts a token with an upload scope', () => {
    expect(
      validateYouTubeAuth({ accessToken: 'ya29.x', refreshToken: 'r', scopes: [UPLOAD_SCOPE] }),
    ).toEqual({ errors: [] });
  });

  it('accepts the wider manage scope too', () => {
    expect(validateYouTubeAuth({ accessToken: 'ya29.x', scopes: [MANAGE_SCOPE] }).errors).toEqual(
      [],
    );
  });

  it('refuses a token minted without any upload scope', () => {
    const result = validateYouTubeAuth({
      accessToken: 'ya29.x',
      scopes: ['https://www.googleapis.com/auth/youtube.readonly'],
    });
    expect(result.errors[0]).toMatch(/carries neither/);
  });

  it('requires an access token', () => {
    expect(validateYouTubeAuth({}).errors[0]).toMatch(/requires an 'accessToken'/);
  });

  it('asks for re-authorization, not a retry, when the token has lapsed and cannot be refreshed', () => {
    const result = validateYouTubeAuth({
      accessToken: 'ya29.x',
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });

    // The distinction matters to the host: a malformed credential is a
    // configuration bug, a spent one is a user action.
    expect(result.code).toBe(ErrorCode.AUTH_REFRESH_REQUIRED);
  });

  it('says nothing about an expired token that has a refresh token to use', () => {
    const result = validateYouTubeAuth({
      accessToken: 'ya29.x',
      refreshToken: 'r',
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(result.errors).toEqual([]);
  });
});
