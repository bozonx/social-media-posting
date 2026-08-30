import { describe, expect, it } from 'vitest';
import { UPLOAD_SCOPE, validateVimeoAuth } from '../src/vimeo-auth.validator.js';

describe('validateVimeoAuth', () => {
  it('accepts a token carrying the upload scope', () => {
    expect(validateVimeoAuth({ accessToken: 'v', scopes: [UPLOAD_SCOPE, 'edit'] })).toEqual({
      errors: [],
    });
  });

  it('accepts a token that states no scopes at all', () => {
    // A personal access token does not always report its scopes; refusing one
    // would reject a credential that works.
    expect(validateVimeoAuth({ accessToken: 'v' }).errors).toEqual([]);
  });

  it('refuses a token that states scopes but not upload', () => {
    expect(validateVimeoAuth({ accessToken: 'v', scopes: ['public'] }).errors[0]).toMatch(
      /every upload will be refused/,
    );
  });

  it('requires an access token', () => {
    expect(validateVimeoAuth({}).errors[0]).toMatch(/requires an 'accessToken'/);
  });
});
