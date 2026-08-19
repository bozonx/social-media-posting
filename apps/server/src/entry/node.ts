import { serve } from '@hono/node-server';
import { createApp } from '../app.js';
import { loadYamlConfig } from '../config/load-yaml.js';
import { readConfigFromEnv } from '../config/env.js';

/** How long to wait for in-flight requests before exiting anyway. */
const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 25_000;

/**
 * The Node deployment: reads `config.yaml`, listens on a port, and drains on
 * SIGTERM.
 *
 * The Workers deployment (`entry/worker.ts`) shares every line of `createApp`
 * and differs only here, in how the process is started and configured.
 */
function main(): void {
  const env = process.env as Record<string, string | undefined>;
  const config = readConfigFromEnv(env) ?? loadYamlConfig();
  const { app, drain, logger, options } = createApp({ config, env });

  const server = serve({ fetch: app.fetch, hostname: options.host, port: options.port });

  logger.log(
    `${options.serviceName} ${options.serviceVersion} listening on http://${options.host}:${options.port}`,
    'Bootstrap',
  );

  const shutdown = async (signal: string): Promise<void> => {
    const startedAt = Date.now();
    logger.log(`Received ${signal}, draining (in-flight: ${drain.inFlightCount})`, 'Bootstrap');
    drain.startDraining();

    // Keep answering health with 503 for a moment so load balancers notice
    // before the socket disappears.
    if (options.shutdownDrainSeconds > 0) {
      await new Promise(resolve => setTimeout(resolve, options.shutdownDrainSeconds * 1000));
    }

    await drain.waitForIdle(GRACEFUL_SHUTDOWN_TIMEOUT_MS);
    server.close(() => {
      logger.log(`Closed gracefully in ${Date.now() - startedAt}ms`, 'Bootstrap');
      process.exit(0);
    });

    // The socket may still hold a connection open past the grace period.
    setTimeout(() => process.exit(0), GRACEFUL_SHUTDOWN_TIMEOUT_MS).unref();
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

void main();
