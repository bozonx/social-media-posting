import 'reflect-metadata';
import { setTimeout as sleep } from 'node:timers/promises';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import type { AppConfig } from './config/app.config.js';
import { GRACEFUL_SHUTDOWN_TIMEOUT_MS } from './app.constants.js';
import { ShutdownService } from './common/services/shutdown.service.js';
import { buildApiPrefix } from './common/http/api-prefix.js';
import { SERVICE_NAME, SERVICE_VERSION } from './config/service-info.js';

/**
 * Bootstrap the NestJS application with Fastify adapter
 * Initializes the application with Pino logger, global validation pipes,
 * and configures the API prefix based on environment settings
 */
async function bootstrap() {
  // Create app with bufferLogs enabled to capture early logs
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      logger: false, // We'll use Pino logger instead
      // Force close idle connections during shutdown to prevent hanging
      forceCloseConnections: 'idle',
      // Timeout for establishing connections (60 seconds)
      connectionTimeout: 60000,
      // Timeout for processing requests (10 minutes - should be higher than requestTimeoutSecs)
      requestTimeout: 600000,
    }),
    {
      bufferLogs: true,
    },
  );

  // Use Pino logger for the entire application
  app.useLogger(app.get(Logger));

  const configService = app.get(ConfigService);
  const logger = app.get(Logger);
  const shutdownService = app.get(ShutdownService);

  const appConfig = configService.get<AppConfig>('app')!;

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  // Configure global API prefix from configuration
  // If BASE_PATH is set, prefix will be BASE_PATH/api/v1, otherwise just api/v1
  const globalPrefix = buildApiPrefix(appConfig.basePath);
  app.setGlobalPrefix(globalPrefix);

  // Setup explicit signal handlers for graceful shutdown BEFORE starting the server
  // This prevents race condition where signal arrives before handlers are registered
  const handleShutdown = async (signal: string) => {
    const shutdownStartTime = Date.now();
    const inFlightCount = shutdownService.getInFlightRequestsCount();
    shutdownService.startDraining();

    logger.log(
      `Received ${signal}, starting graceful shutdown... (in-flight requests: ${inFlightCount})`,
      'Bootstrap',
    );

    // Set a timeout to force shutdown if graceful shutdown takes too long
    const forceShutdownTimer = setTimeout(() => {
      const duration = Date.now() - shutdownStartTime;
      const remainingRequests = shutdownService.getInFlightRequestsCount();

      logger.warn(
        `Graceful shutdown timeout (${GRACEFUL_SHUTDOWN_TIMEOUT_MS}ms) exceeded after ${duration}ms, forcing shutdown`,
        'Bootstrap',
      );
      logger.warn(`In-flight requests remaining: ${remainingRequests}`, 'Bootstrap');
      process.exit(0);
    }, GRACEFUL_SHUTDOWN_TIMEOUT_MS);

    try {
      if (appConfig.shutdownDrainSeconds > 0) {
        await sleep(appConfig.shutdownDrainSeconds * 1000);
      }
      // Close the application gracefully
      await app.close();
      clearTimeout(forceShutdownTimer);

      const duration = Date.now() - shutdownStartTime;
      logger.log(`Application closed gracefully in ${duration}ms`, 'Bootstrap');
      process.exit(0);
    } catch (error) {
      clearTimeout(forceShutdownTimer);

      const duration = Date.now() - shutdownStartTime;
      logger.error(`Error during shutdown after ${duration}ms: ${error}`, 'Bootstrap');
      // Use exit code 0 even on error to avoid unnecessary alerts
      // The error has been logged and graceful shutdown was attempted
      process.exit(0);
    }
  };

  process.on('SIGTERM', () => void handleShutdown('SIGTERM'));
  process.on('SIGINT', () => void handleShutdown('SIGINT'));

  await app.listen(appConfig.port, appConfig.host);

  logger.log(
    `${SERVICE_NAME} ${SERVICE_VERSION} listening on http://${appConfig.host}:${appConfig.port}/${globalPrefix}`,
    'Bootstrap',
  );
  logger.log(`📊 Environment: ${appConfig.nodeEnv}`, 'Bootstrap');
  logger.log(`📝 Log level: ${appConfig.logLevel}`, 'Bootstrap');
  logger.log(`⏱️  Graceful shutdown timeout: ${GRACEFUL_SHUTDOWN_TIMEOUT_MS}ms`, 'Bootstrap');
}

void bootstrap();
