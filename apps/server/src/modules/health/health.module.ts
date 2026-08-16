import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import { ShutdownModule } from '../../common/services/shutdown.module.js';

@Module({
  imports: [ShutdownModule],
  controllers: [HealthController],
})
export class HealthModule {}
