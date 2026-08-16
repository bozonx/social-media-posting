import { HTTPException } from 'hono/http-exception';
import { ZodError } from 'zod';
import type { Context, ErrorHandler } from 'hono';
import type { ILogger } from '@bozonx/social-posting';
import { PostingError } from '@bozonx/social-posting';

/**
 * Turn anything thrown while handling a request into one JSON error shape.
 *
 * Publish failures do not come through here: those are results, not exceptions,
 * and the route returns them with a 200 so a caller reads `success` in one
 * place rather than branching on status codes.
 *
 * @param logger - Where the failure is recorded.
 */
export function errorHandler(logger: ILogger): ErrorHandler {
  return (error, c) => {
    if (error instanceof ZodError) {
      return respond(c, 400, 'Validation failed', {
        error: 'Bad Request',
        details: error.issues.map(issue => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }

    if (error instanceof HTTPException) {
      return respond(c, error.status, error.message, { error: 'HTTPException' });
    }

    if (error instanceof PostingError) {
      return respond(c, 400, error.message, {
        error: error.name,
        code: error.code,
        retryable: error.retryable,
      });
    }

    logger.error(
      `Unhandled failure on ${c.req.method} ${c.req.path}: ${error.message}`,
      error.stack,
      'ErrorHandler',
    );

    return respond(c, 500, 'Internal server error', { error: 'InternalServerError' });
  };
}

function respond(
  c: Context,
  status: number,
  message: string,
  extra: Record<string, unknown>,
): Response {
  return c.json(
    {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: c.req.path,
      method: c.req.method,
      message,
      ...extra,
    },
    status as 400,
  );
}
