import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import {
  AuthValidatorRegistry,
  PlatformRegistry,
  PostService,
  PostingConfig,
  PreviewService,
} from '@bozonx/social-posting';
import { telegram } from '@bozonx/social-posting-telegram';
import type { ILogger, PlatformModule, PostServiceDeps } from '@bozonx/social-posting';
import { JsonLogger } from './logger.js';
import { DrainTracker } from './middleware/drain.js';
import { bearerAuth } from './middleware/auth.js';
import { errorHandler } from './middleware/errors.js';
import { healthRoutes } from './routes/health.routes.js';
import { postRoutes } from './routes/post.routes.js';
import { buildApiPrefix, readRuntimeOptions, type ServerEnv } from './config/env.js';
import type { ServerConfig } from './config/schema.js';

/**
 * The networks this deployment serves.
 *
 * Adding one is a line here plus a dependency; nothing in the library changes.
 */
export const PLATFORMS: PlatformModule[] = [telegram];

/** Everything needed to build the HTTP app. */
export interface CreateAppOptions {
  /** Platform and account configuration. */
  config: ServerConfig;
  /** Environment the runtime settings come from. */
  env?: ServerEnv;
  /** Logger; a JSON console logger at the configured level by default. */
  logger?: ILogger;
  /** Networks to serve; the built-in list by default. */
  platforms?: PlatformModule[];
  /** Shutdown tracker, when the runtime has a lifecycle to drain. */
  drain?: DrainTracker;
}

/** The app, plus the pieces an entry point needs to run and stop it. */
export interface CreatedApp {
  app: Hono;
  drain: DrainTracker;
  logger: ILogger;
  options: ReturnType<typeof readRuntimeOptions>;
}

/**
 * Build the HTTP shell.
 *
 * Hono, so the same source runs on Node, Workers, Deno and Bun: it is written
 * against web-standard `Request` and `Response` rather than Node's `req`/`res`.
 *
 * @param options - Configuration, environment, logger and platforms.
 */
export function createApp(options: CreateAppOptions): CreatedApp {
  const env = options.env ?? {};
  const runtime = readRuntimeOptions(env);
  const logger = options.logger ?? new JsonLogger(runtime.logLevel, runtime.serviceName);
  const drain = options.drain ?? new DrainTracker();

  const platformRegistry = new PlatformRegistry();
  const authValidatorRegistry = new AuthValidatorRegistry();
  for (const platformModule of options.platforms ?? PLATFORMS) {
    platformRegistry.register(platformModule.create({ logger }));
    if (platformModule.authValidator) {
      authValidatorRegistry.register(platformModule.authValidator);
    }
  }

  const deps: PostServiceDeps = {
    config: new PostingConfig({
      accounts: options.config.accounts,
      requestTimeoutSecs: options.config.requestTimeoutSecs,
    }),
    platformRegistry,
    authValidatorRegistry,
    logger,
  };

  const app = new Hono();
  app.onError(errorHandler(logger));

  const prefix = `/${buildApiPrefix(runtime.basePath)}`;
  const api = new Hono();

  // Health is answered even while draining, so a load balancer learns to stop.
  api.route(
    '/',
    healthRoutes({
      drain,
      serviceName: runtime.serviceName,
      serviceVersion: runtime.serviceVersion,
      startedAt: Date.now(),
    }),
  );

  api.use('*', drain.middleware());
  api.use('*', bearerAuth(runtime.authBearerTokens));
  api.use(
    '*',
    bodyLimit({
      maxSize: runtime.maxRequestBodyBytes,
      onError: c =>
        c.json(
          { statusCode: 413, message: 'Request body is too large', error: 'PayloadTooLarge' },
          413,
        ),
    }),
  );
  api.route(
    '/',
    postRoutes({
      postService: new PostService(deps),
      previewService: new PreviewService(deps),
      allowInlineAuth: runtime.allowInlineAuth,
      includeRawResponses: runtime.includeRawResponses,
    }),
  );

  app.route(prefix, api);

  return { app, drain, logger, options: runtime };
}
