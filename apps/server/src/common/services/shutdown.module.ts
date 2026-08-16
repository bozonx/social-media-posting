import { Module } from '@nestjs/common';
import { ShutdownService } from './shutdown.service.js';

@Module({
  providers: [ShutdownService],
  exports: [ShutdownService],
})
export class ShutdownModule {}
