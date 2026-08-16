import type { MiddlewareHandler } from 'hono';

/**
 * Bearer-token authentication.
 *
 * With no tokens configured, authentication is off — the shell is then expected
 * to sit behind something that does it.
 *
 * @param allowedTokens - Tokens that grant access.
 */
export function bearerAuth(allowedTokens: string[]): MiddlewareHandler {
  return async (c, next) => {
    if (allowedTokens.length === 0) {
      return next();
    }

    const header = c.req.header('authorization');
    if (!header) {
      return c.json(unauthorized('Authorization header is missing'), 401);
    }

    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) {
      return c.json(unauthorized('Invalid authorization format. Expected: Bearer <token>'), 401);
    }

    if (!allowedTokens.includes(token)) {
      return c.json(unauthorized('Invalid Bearer token'), 401);
    }

    return next();
  };
}

function unauthorized(message: string) {
  return { statusCode: 401, message, error: 'Unauthorized' };
}
