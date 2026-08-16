import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { HealthController } from '../../src/modules/health/health.controller.js';
import { ShutdownService } from '../../src/common/services/shutdown.service.js';
import type { FastifyReply } from 'fastify';

describe('HealthController (unit)', () => {
  let controller: HealthController;
  let moduleRef: TestingModule;
  const send = vi.fn();
  const status = vi.fn(() => ({ send }));

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: ShutdownService, useValue: { shuttingDown: false } }],
    }).compile();

    controller = moduleRef.get<HealthController>(HealthController);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('GET /api/v1/health returns identity and uptime', () => {
    controller.check({ status } as unknown as FastifyReply);
    expect(status).toHaveBeenCalledWith(200);
    expect(send).toHaveBeenCalledWith({
      status: 'ok',
      service: 'social-media-posting-microservice',
      version: 'dev',
      uptimeSec: expect.any(Number),
    });
  });
});
