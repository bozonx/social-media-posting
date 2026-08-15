import { jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '@/app.module.js';
import { AppConfigService } from '@/modules/app-config/app-config.service.js';
import { buildApiPrefix } from '@/common/http/api-prefix.js';

export async function createTestApp(): Promise<NestFastifyApplication> {
  const mockAppConfigService = {
    onModuleInit: jest.fn(),
    get: jest.fn(),
    getAccount: jest.fn(),
    getAllAccounts: jest.fn(),
    getCommonConfig: jest.fn().mockReturnValue({
      retryAttempts: 1,
      retryDelayMs: 0,
    }),
    getConversionConfig: jest.fn().mockReturnValue({}),
  };

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(AppConfigService)
    .useValue(mockAppConfigService)
    .compile();

  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter({
      logger: false, // We'll use Pino logger instead
    }),
  );

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  // Ensure defaults the same as in main.ts
  const globalPrefix = buildApiPrefix(process.env.BASE_PATH);
  app.setGlobalPrefix(globalPrefix);

  await app.init();
  // Ensure Fastify has completed plugin registration and routing before tests
  await app.getHttpAdapter().getInstance().ready();
  return app;
}
