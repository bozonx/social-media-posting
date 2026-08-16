import { createApp } from '../../src/app.js';
import type { ILogger, PlatformModule } from '@bozonx/social-posting';
import type { CreatedApp } from '../../src/app.js';
import type { ServerConfig } from '../../src/config/schema.js';
import type { ServerEnv } from '../../src/config/env.js';

export const silentLogger: ILogger = {
  debug: () => {},
  log: () => {},
  warn: () => {},
  error: () => {},
};

/**
 * Build the real app with test doubles for the networks.
 *
 * Routing, auth, draining and error handling are the ones production runs;
 * only the platforms are swapped.
 */
export function createTestApp(options: {
  platforms: PlatformModule[];
  config?: Partial<ServerConfig>;
  env?: ServerEnv;
}): CreatedApp {
  return createApp({
    config: {
      requestTimeoutSecs: options.config?.requestTimeoutSecs ?? 10,
      accounts: options.config?.accounts ?? {},
    },
    env: { ALLOW_INLINE_AUTH: 'true', ...options.env },
    logger: silentLogger,
    platforms: options.platforms,
  });
}

/** POST a JSON body to the app and read the JSON back. */
export async function postJson(
  app: CreatedApp['app'],
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: Record<string, any> }> {
  const response = await app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : {} };
}
