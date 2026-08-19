import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { bearerAuth } from '../../src/middleware/auth.js';

describe('bearerAuth middleware', () => {
  it('allows all requests when allowedTokens is empty (auth disabled)', async () => {
    const app = new Hono();
    app.use('*', bearerAuth([]));
    app.get('/test', c => c.json({ ok: true }));

    const res = await app.request('/test');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('rejects request when Authorization header is missing', async () => {
    const app = new Hono();
    app.use('*', bearerAuth(['secret-token']));
    app.get('/test', c => c.json({ ok: true }));

    const res = await app.request('/test');

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      statusCode: 401,
      message: 'Authorization header is missing',
      error: 'Unauthorized',
    });
  });

  it('rejects request when Authorization format is invalid (not Bearer)', async () => {
    const app = new Hono();
    app.use('*', bearerAuth(['secret-token']));
    app.get('/test', c => c.json({ ok: true }));

    const res = await app.request('/test', {
      headers: { authorization: 'Basic dXNlcjpwYXNz' },
    });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      statusCode: 401,
      message: 'Invalid authorization format. Expected: Bearer <token>',
      error: 'Unauthorized',
    });
  });

  it('rejects request when Bearer token is empty', async () => {
    const app = new Hono();
    app.use('*', bearerAuth(['secret-token']));
    app.get('/test', c => c.json({ ok: true }));

    const res = await app.request('/test', {
      headers: { authorization: 'Bearer ' },
    });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      statusCode: 401,
      message: 'Invalid authorization format. Expected: Bearer <token>',
      error: 'Unauthorized',
    });
  });

  it('rejects request when Bearer token does not match any allowed token', async () => {
    const app = new Hono();
    app.use('*', bearerAuth(['token-a', 'token-b']));
    app.get('/test', c => c.json({ ok: true }));

    const res = await app.request('/test', {
      headers: { authorization: 'Bearer wrong-token' },
    });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      statusCode: 401,
      message: 'Invalid Bearer token',
      error: 'Unauthorized',
    });
  });

  it('allows request when Bearer token matches one of the allowed tokens', async () => {
    const app = new Hono();
    app.use('*', bearerAuth(['token-a', 'token-b']));
    app.get('/test', c => c.json({ ok: true }));

    const res = await app.request('/test', {
      headers: { authorization: 'Bearer token-b' },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
