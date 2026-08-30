import { describe, expect, it } from 'vitest';
import { ErrorCode } from '@bozonx/social-posting';
import { MANAGE_VIDEOS_SCOPE, validateDailymotionAuth } from '../src/dailymotion-auth.validator.js';

describe('validateDailymotionAuth', () => {
  it('accepts a token carrying the manage_videos scope', () => {
    expect(
      validateDailymotionAuth({
        accessToken: 'dm',
        refreshToken: 'r',
        scopes: [MANAGE_VIDEOS_SCOPE],
      }),
    ).toEqual({ errors: [] });
  });

  it('refuses a token that states scopes but not manage_videos', () => {
    expect(validateDailymotionAuth({ accessToken: 'dm', scopes: ['userinfo'] }).errors[0]).toMatch(
      /manage_videos/,
    );
  });

  it('requires an access token', () => {
    expect(validateDailymotionAuth({}).errors[0]).toMatch(/requires an 'accessToken'/);
  });

  it('asks for re-authorization when the token has lapsed and cannot be refreshed', () => {
    const result = validateDailymotionAuth({
      accessToken: 'dm',
      expiresAt: Date.now() - 60_000,
    });
    expect(result.code).toBe(ErrorCode.AUTH_REFRESH_REQUIRED);
  });
});
