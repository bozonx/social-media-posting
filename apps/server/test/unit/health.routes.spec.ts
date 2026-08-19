import { describe, expect, it } from 'vitest';
import { DrainTracker } from '../../src/middleware/drain.js';
import { healthRoutes } from '../../src/routes/health.routes.js';

describe('healthRoutes', () => {
  it('returns 200 OK with service details when running normally', async () => {
    const drain = new DrainTracker();
    const startedAt = Date.now() - 5000;
    const routes = healthRoutes({
      drain,
      serviceName: 'social-posting-server',
      serviceVersion: '1.2.3',
      startedAt,
    });

    const res = await routes.request('/health');

    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.status).toBe('ok');
    expect(data.service).toBe('social-posting-server');
    expect(data.version).toBe('1.2.3');
    expect(data.uptimeSec).toBeGreaterThanOrEqual(5);
  });

  it('returns 503 Service Unavailable with status "shutting_down" when draining', async () => {
    const drain = new DrainTracker();
    drain.startDraining();

    const routes = healthRoutes({
      drain,
      serviceName: 'social-posting-server',
      serviceVersion: '1.2.3',
      startedAt: Date.now(),
    });

    const res = await routes.request('/health');

    expect(res.status).toBe(503);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.status).toBe('shutting_down');
    expect(data.service).toBe('social-posting-server');
    expect(data.version).toBe('1.2.3');
  });
});
