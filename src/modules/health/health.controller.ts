import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { Public } from '../../common/decorators/public.decorator.js';
import { ShutdownService } from '../../common/services/shutdown.service.js';
import { SERVICE_NAME, SERVICE_VERSION } from '../../config/service-info.js';

/**
 * Simple health check controller
 * Provides a minimal `/health` endpoint
 */
@Public()
@Controller('health')
export class HealthController {
  private readonly startedAt = Date.now();

  constructor(private readonly shutdown: ShutdownService) {}
  /**
   * Basic health check endpoint returning a simple OK status
   */
  @Get()
  public check(@Res() reply: FastifyReply): void {
    const shuttingDown = this.shutdown.shuttingDown;
    void reply.status(shuttingDown ? HttpStatus.SERVICE_UNAVAILABLE : HttpStatus.OK).send({
      status: shuttingDown ? 'shutting_down' : 'ok',
      service: SERVICE_NAME,
      version: SERVICE_VERSION,
      uptimeSec: Math.floor((Date.now() - this.startedAt) / 1000),
    });
  }
}
