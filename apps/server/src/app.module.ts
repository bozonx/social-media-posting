import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR, APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { HealthModule } from './modules/health/health.module.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { ShutdownModule } from './common/services/shutdown.module.js';
import { ShutdownInterceptor } from './common/interceptors/shutdown.interceptor.js';
import { BearerAuthGuard } from './common/guards/bearer-auth.guard.js';
import appConfig from './config/app.config.js';
import type { AppConfig } from './config/app.config.js';
import yamlConfig from './config/yaml.config.js';
import { SERVICE_NAME } from './config/service-info.js';
import { PostModule } from './modules/post/post.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, yamlConfig],
      envFilePath: ['.env'],
      cache: true,
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const appConfig = configService.get<AppConfig>('app')!;
        const isDev = appConfig.nodeEnv === 'development';

        return {
          pinoHttp: {
            level: appConfig.logLevel,
            timestamp: () => `,"@timestamp":"${new Date().toISOString()}"`,
            base: {
              service: SERVICE_NAME,
              environment: appConfig.nodeEnv,
            },
            transport: isDev
              ? {
                  target: 'pino-pretty',
                  options: {
                    colorize: true,
                    singleLine: false,
                    translateTime: "UTC:yyyy-mm-dd'T'HH:MM:ss.l'Z'",
                    ignore: 'pid,hostname',
                    messageFormat: '[{context}] {msg}',
                  },
                }
              : undefined,
            serializers: {
              req: req => ({
                id: req.id,
                method: req.method,
                url: req.url,
                path: req.url?.split('?')[0],
                remoteAddress: req.ip,
                remotePort: req.socket?.remotePort,
              }),
              res: res => ({
                statusCode: res.statusCode,
              }),
              err: err => ({
                type: err.type,
                message: err.message,
                stack: err.stack,
              }),
            },
            redact: {
              paths: ['req.headers.authorization', 'req.headers["x-api-key"]'],
              censor: '[REDACTED]',
            },
            customLogLevel: (req, res, err) => {
              if (res.statusCode >= 500 || err) {
                return 'error';
              }
              if (res.statusCode >= 400) {
                return 'warn';
              }
              if (res.statusCode >= 300) {
                return 'info';
              }
              return 'info';
            },
            autoLogging: {
              ignore: req => {
                if (appConfig.nodeEnv === 'production') {
                  return req.url?.includes('/health') || false;
                }
                return false;
              },
            },
          },
        };
      },
    }),
    HealthModule,
    ShutdownModule,
    PostModule,
  ],
  controllers: [],
  providers: [
    {
      provide: APP_GUARD,
      useClass: BearerAuthGuard,
    },
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: ShutdownInterceptor,
    },
  ],
  exports: [ShutdownModule],
})
export class AppModule {}
