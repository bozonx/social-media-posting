import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { ErrorCode, ValidationError } from '@bozonx/social-posting';
import type { ILogger } from '@bozonx/social-posting';
import { errorHandler } from '../../src/middleware/errors.js';

describe('errorHandler middleware', () => {
  const createMockLogger = (): ILogger & { errorSpy: ReturnType<typeof vi.fn> } => {
    const errorSpy = vi.fn();
    return {
      debug: vi.fn(),
      log: vi.fn(),
      warn: vi.fn(),
      error: errorSpy,
      errorSpy,
    };
  };

  it('formats ZodError as 400 Bad Request with field paths and messages', async () => {
    const logger = createMockLogger();
    const app = new Hono();
    app.onError(errorHandler(logger));

    const testSchema = z.object({
      platform: z.string({ message: 'platform is required' }),
      count: z.number().min(1, { message: 'count must be at least 1' }),
    });

    app.post('/test', async c => {
      const body = await c.req.json();
      testSchema.parse(body);
      return c.json({ ok: true });
    });

    const res = await app.request('/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ count: 0 }),
    });

    expect(res.status).toBe(400);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.statusCode).toBe(400);
    expect(data.error).toBe('Bad Request');
    expect(data.message).toBe('Validation failed');
    expect(data.details).toEqual([
      { path: 'platform', message: 'platform is required' },
      { path: 'count', message: 'count must be at least 1' },
    ]);
  });

  it('formats HTTPException with its status and message', async () => {
    const logger = createMockLogger();
    const app = new Hono();
    app.onError(errorHandler(logger));

    app.get('/unauthorized', () => {
      throw new HTTPException(401, { message: 'Custom unauthorized message' });
    });

    const res = await app.request('/unauthorized');

    expect(res.status).toBe(401);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.statusCode).toBe(401);
    expect(data.message).toBe('Custom unauthorized message');
    expect(data.error).toBe('HTTPException');
  });

  it('formats PostingError / ValidationError as 400 with code and retryable', async () => {
    const logger = createMockLogger();
    const app = new Hono();
    app.onError(errorHandler(logger));

    app.get('/validation-fail', () => {
      throw new ValidationError('Field "account" is required');
    });

    const res = await app.request('/validation-fail');

    expect(res.status).toBe(400);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.statusCode).toBe(400);
    expect(data.message).toBe('Field "account" is required');
    expect(data.code).toBe(ErrorCode.VALIDATION_ERROR);
    expect(data.retryable).toBe(false);
    expect(data.error).toBe('ValidationError');
  });

  it('handles generic unhandled error as 500 and logs to logger.error', async () => {
    const logger = createMockLogger();
    const app = new Hono();
    app.onError(errorHandler(logger));

    const boomError = new Error('Database connection broke');
    app.get('/boom', () => {
      throw boomError;
    });

    const res = await app.request('/boom');

    expect(res.status).toBe(500);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.statusCode).toBe(500);
    expect(data.message).toBe('Internal server error');
    expect(data.error).toBe('InternalServerError');

    expect(logger.errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Unhandled failure on GET /boom: Database connection broke'),
      boomError.stack,
      'ErrorHandler',
    );
  });
});
