import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  AuthValidatorRegistry,
  PlatformRegistry,
  PostingConfig,
  type AccountConfig,
  type ILogger,
  type IPlatform,
  type PostServiceDeps,
} from '@bozonx/social-posting';
import { AppModule } from '../../src/app.module.js';
import { POST_SERVICE_DEPS } from '../../src/modules/post/post.module.js';
import { buildApiPrefix } from '../../src/common/http/api-prefix.js';

const silentLogger: ILogger = { debug: () => {}, log: () => {}, warn: () => {}, error: () => {} };

export interface TestAppOptions {
  /** Platforms the app should serve. */
  platforms?: IPlatform[];
  /** Accounts available to the app. */
  accounts?: Record<string, AccountConfig>;
  /** Overall request timeout, in seconds. */
  requestTimeoutSecs?: number;
  /** Global API prefix; defaults to the one derived from BASE_PATH. */
  globalPrefix?: string;
}

/**
 * Boot the HTTP shell with the core wired to test doubles.
 *
 * Only the composition root is overridden — routing, guards, pipes and the
 * exception filter are the ones the real app uses.
 */
export async function createTestApp(options: TestAppOptions = {}): Promise<NestFastifyApplication> {
  const platformRegistry = new PlatformRegistry();
  for (const platform of options.platforms ?? []) {
    platformRegistry.register(platform);
  }

  const deps: PostServiceDeps = {
    config: new PostingConfig({
      accounts: options.accounts ?? {},
      requestTimeoutSecs: options.requestTimeoutSecs ?? 10,
    }),
    platformRegistry,
    authValidatorRegistry: new AuthValidatorRegistry(),
    logger: silentLogger,
  };

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(POST_SERVICE_DEPS)
    .useValue(deps)
    .compile();

  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter({ logger: false }),
  );

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.setGlobalPrefix(options.globalPrefix ?? buildApiPrefix(process.env.BASE_PATH));

  await app.init();
  // Fastify must finish plugin registration before the first request.
  await app.getHttpAdapter().getInstance().ready();
  return app;
}
