import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import {
  AuthValidatorRegistry,
  PlatformRegistry,
  PostService,
  PostingConfig,
  PreviewService,
} from '@bozonx/social-posting';
import { TelegramAuthValidator, TelegramPlatform } from '@bozonx/social-posting-telegram';
import type { ILogger, PostServiceDeps } from '@bozonx/social-posting';
import { PostController } from './post.controller.js';
import { PinoLoggerAdapter } from '../../common/logging/pino-logger.adapter.js';
import { YAML_CONFIG_NAMESPACE } from '../../config/yaml.config.js';
import type { YamlConfigDto } from '../../config/yaml-config.dto.js';
import { ShutdownModule } from '../../common/services/shutdown.module.js';

/** Injection token for the core's logger port. */
export const CORE_LOGGER = Symbol('CORE_LOGGER');
/** Injection token for the resolved core configuration. */
export const POSTING_CONFIG = Symbol('POSTING_CONFIG');
/** Injection token for the bundle of collaborators the core services take. */
export const POST_SERVICE_DEPS = Symbol('POST_SERVICE_DEPS');

/**
 * Composition root of the HTTP shell.
 *
 * Nest wires plain classes here; the core itself knows nothing about Nest,
 * which platforms exist, or how the shell is configured.
 */
@Module({
  imports: [ShutdownModule],
  controllers: [PostController],
  providers: [
    {
      provide: CORE_LOGGER,
      inject: [PinoLogger],
      useFactory: (pino: PinoLogger): ILogger => new PinoLoggerAdapter(pino),
    },
    {
      provide: POSTING_CONFIG,
      inject: [ConfigService],
      useFactory: (configService: ConfigService): PostingConfig => {
        const yamlConfig = configService.get<YamlConfigDto>(YAML_CONFIG_NAMESPACE);
        if (!yamlConfig) {
          throw new Error(`Configuration section "${YAML_CONFIG_NAMESPACE}" is not loaded`);
        }
        return new PostingConfig({
          accounts: yamlConfig.accounts,
          requestTimeoutSecs: yamlConfig.requestTimeoutSecs,
        });
      },
    },
    {
      provide: POST_SERVICE_DEPS,
      inject: [POSTING_CONFIG, CORE_LOGGER],
      useFactory: (config: PostingConfig, logger: ILogger): PostServiceDeps => {
        const platformRegistry = new PlatformRegistry();
        const authValidatorRegistry = new AuthValidatorRegistry();

        platformRegistry.register(new TelegramPlatform({ logger }));
        authValidatorRegistry.register(new TelegramAuthValidator());

        return { config, platformRegistry, authValidatorRegistry, logger };
      },
    },
    {
      provide: PostService,
      inject: [POST_SERVICE_DEPS],
      useFactory: (deps: PostServiceDeps) => new PostService(deps),
    },
    {
      provide: PreviewService,
      inject: [POST_SERVICE_DEPS],
      useFactory: (deps: PostServiceDeps) => new PreviewService(deps),
    },
  ],
})
export class PostModule {}
