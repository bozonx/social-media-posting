import { Controller, Post, Body, HttpCode, HttpStatus, Req, Logger } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { PostService, PreviewService } from '@bozonx/social-posting';
import type { PostResult, PreviewResult } from '@bozonx/social-posting';
import { PostRequestDto } from './dto/post-request.dto.js';

@Controller()
export class PostController {
  private readonly logger = new Logger(PostController.name);

  constructor(
    private readonly postService: PostService,
    private readonly previewService: PreviewService,
  ) {}

  @Post('post')
  @HttpCode(HttpStatus.OK)
  async publish(@Body() request: PostRequestDto, @Req() req: FastifyRequest): Promise<PostResult> {
    const { signal, cleanup } = this.createAbortSignal(req);
    try {
      return await this.postService.publish(request, { signal });
    } finally {
      cleanup();
    }
  }

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  async preview(@Body() request: PostRequestDto): Promise<PreviewResult> {
    return this.previewService.preview(request);
  }
  private createAbortSignal(req: FastifyRequest): { signal: AbortSignal; cleanup: () => void } {
    const controller = new AbortController();
    const raw = req.raw;
    let isFinished = false;

    // raw.destroyed is true after body parsing - this is normal, don't abort on it
    // Only abort if raw.aborted (client disconnected before body was fully read)
    if (raw.aborted) {
      this.logger.warn('Request aborted before body parsing completed');
      controller.abort();
      return { signal: controller.signal, cleanup: () => {} };
    }

    const onAbort = () => {
      if (!isFinished && !controller.signal.aborted) {
        this.logger.warn('Aborting request due to client disconnect during processing');
        controller.abort();
      }
    };

    raw.on('aborted', onAbort);
    raw.on('close', onAbort);

    // Also listen to socket events as a fallback
    if (raw.socket) {
      raw.socket.on('close', onAbort);
    }

    return {
      signal: controller.signal,
      cleanup: () => {
        isFinished = true;
        raw.removeListener('aborted', onAbort);
        raw.removeListener('close', onAbort);
        if (raw.socket) {
          raw.socket.removeListener('close', onAbort);
        }
      },
    };
  }
}
