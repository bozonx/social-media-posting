import { createApp } from '../app.js';
import { readConfigFromEnv } from '../config/env.js';
import type { ServerEnv } from '../config/env.js';

const apps = new WeakMap<object, ReturnType<typeof createApp>>();

/**
 * The Cloudflare Workers deployment.
 *
 * Configuration arrives as `CONFIG_JSON`, because a Worker has no filesystem to
 * read `config.yaml` from. Everything else is the same app the Node deployment
 * runs — see `docs/RUNTIMES.md` for what a Worker can and cannot publish.
 */
export default {
  async fetch(request: Request, env: ServerEnv): Promise<Response> {
    const config = readConfigFromEnv(env);
    if (!config) {
      return Response.json(
        {
          statusCode: 500,
          message: 'CONFIG_JSON is not set. A Workers deployment is configured through it.',
          error: 'ConfigurationError',
        },
        { status: 500 },
      );
    }

    let created = apps.get(env);
    if (!created) {
      created = createApp({ config, env });
      apps.set(env, created);
    }
    const { app } = created;
    return app.fetch(request, env);
  },
};
