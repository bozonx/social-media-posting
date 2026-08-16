import { Hono } from 'hono';
import type { DrainTracker } from '../middleware/drain.js';

/** What the health route reports on. */
export interface HealthRouteDeps {
  drain: DrainTracker;
  serviceName: string;
  serviceVersion: string;
  startedAt: number;
}

/**
 * `GET /health`.
 *
 * Answers 503 while draining, so a load balancer stops sending traffic before
 * the process goes away.
 */
export function healthRoutes(deps: HealthRouteDeps): Hono {
  const routes = new Hono();

  routes.get('/health', c => {
    const shuttingDown = deps.drain.shuttingDown;

    return c.json(
      {
        status: shuttingDown ? 'shutting_down' : 'ok',
        service: deps.serviceName,
        version: deps.serviceVersion,
        uptimeSec: Math.floor((Date.now() - deps.startedAt) / 1000),
      },
      shuttingDown ? 503 : 200,
    );
  });

  return routes;
}
