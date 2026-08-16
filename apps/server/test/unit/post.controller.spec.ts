import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { PostController } from '../../src/modules/post/post.controller.js';
import {
  BodyFormat,
  ErrorCode,
  PostService,
  PostType,
  PreviewService,
} from '@bozonx/social-posting';
import type {
  ErrorResponse,
  PostResponse,
  PreviewErrorResponse,
  PreviewResponse,
} from '@bozonx/social-posting';
import type { PostRequestDto } from '../../src/modules/post/dto/post-request.dto.js';

describe('PostController', () => {
  let controller: PostController;
  let postService: PostService;
  let previewService: PreviewService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PostController],
      providers: [
        {
          provide: PostService,
          useValue: {
            publish: vi.fn(),
          },
        },
        {
          provide: PreviewService,
          useValue: {
            preview: vi.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<PostController>(PostController);
    postService = module.get<PostService>(PostService);
    previewService = module.get<PreviewService>(PreviewService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('publish', () => {
    it('should call service.publish with correct parameters', async () => {
      const request: PostRequestDto = {
        platform: 'telegram',
        account: 'test-channel',
        body: 'Test message',
        type: PostType.POST,
      };

      const expectedResponse: PostResponse = {
        success: true,
        data: {
          postId: '123',
          url: 'http://example.com',
          platform: 'telegram',
          type: PostType.POST,
          publishedAt: new Date().toISOString(),
          requestId: 'req-123',
          raw: {},
        },
      };

      (postService.publish as Mock).mockResolvedValue(expectedResponse);

      const mockRequest = {
        raw: {
          destroyed: false,
          aborted: false,
          on: vi.fn(),
          removeListener: vi.fn(),
          socket: {
            on: vi.fn(),
            removeListener: vi.fn(),
          },
        },
      } as any;

      const result = await controller.publish(request, mockRequest);

      expect(postService.publish).toHaveBeenCalledWith(request, expect.any(AbortSignal));
      expect(result).toEqual(expectedResponse);
    });

    it('should return error response from service', async () => {
      const request: PostRequestDto = {
        platform: 'telegram',
        body: 'Test message',
      };

      const errorResponse: ErrorResponse = {
        success: false,
        error: {
          code: ErrorCode.VALIDATION_ERROR,
          message: 'Error message',
          requestId: 'req-123',
        },
      };

      (postService.publish as Mock).mockResolvedValue(errorResponse);

      const mockRequest = {
        raw: {
          destroyed: false,
          aborted: false,
          on: vi.fn(),
          removeListener: vi.fn(),
          socket: {
            on: vi.fn(),
            removeListener: vi.fn(),
          },
        },
      } as any;

      const result = await controller.publish(request, mockRequest);

      expect(postService.publish).toHaveBeenCalledWith(request, expect.any(AbortSignal));
      expect(result).toEqual(errorResponse);
    });
  });

  describe('preview', () => {
    it('should call previewService.preview with correct parameters', async () => {
      const request: PostRequestDto = {
        platform: 'telegram',
        account: 'test-channel',
        body: 'Test message',
      };

      const expectedResponse: PreviewResponse = {
        success: true,
        data: {
          valid: true,
          detectedType: PostType.POST,
          convertedBody: 'Test message',
          targetFormat: BodyFormat.HTML,
          convertedBodyLength: 12,
          warnings: [],
        },
      };

      (previewService.preview as Mock).mockResolvedValue(expectedResponse);

      const result = await controller.preview(request);

      expect(previewService.preview).toHaveBeenCalledWith(request);
      expect(result).toEqual(expectedResponse);
    });

    it('should return error response from preview service', async () => {
      const request: PostRequestDto = {
        platform: 'telegram',
        body: 'Test message',
      };

      const errorResponse: PreviewErrorResponse = {
        success: false,
        data: {
          valid: false,
          errors: ["Either 'account' or 'auth' must be provided"],
          warnings: [],
        },
      };

      (previewService.preview as Mock).mockResolvedValue(errorResponse);

      const result = await controller.preview(request);

      expect(previewService.preview).toHaveBeenCalledWith(request);
      expect(result).toEqual(errorResponse);
    });
  });
});
