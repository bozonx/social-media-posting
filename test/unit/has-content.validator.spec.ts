import { validate } from 'class-validator';
import { PostRequestDto } from '@/modules/post/dto/post-request.dto.js';

describe('HasContent Validator', () => {
  describe('Valid cases', () => {
    it('should pass validation with only body', async () => {
      const dto = new PostRequestDto();
      dto.platform = 'telegram';
      dto.body = 'Test post content';

      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('should pass validation with only cover', async () => {
      const dto = new PostRequestDto();
      dto.platform = 'telegram';
      dto.cover = { src: 'https://example.com/image.jpg' };

      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('should pass validation with only video', async () => {
      const dto = new PostRequestDto();
      dto.platform = 'telegram';
      dto.video = { src: 'https://example.com/video.mp4' };

      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('should pass validation with only audio', async () => {
      const dto = new PostRequestDto();
      dto.platform = 'telegram';
      dto.audio = { src: 'https://example.com/audio.mp3' };

      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('should pass validation with only document', async () => {
      const dto = new PostRequestDto();
      dto.platform = 'telegram';
      dto.document = { src: 'https://example.com/doc.pdf' };

      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('should pass validation with only media array', async () => {
      const dto = new PostRequestDto();
      dto.platform = 'telegram';
      dto.media = [
        { src: 'https://example.com/image1.jpg' },
        { src: 'https://example.com/image2.jpg' },
      ];

      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('should pass validation with body and media', async () => {
      const dto = new PostRequestDto();
      dto.platform = 'telegram';
      dto.body = 'Test post';
      dto.cover = { src: 'https://example.com/image.jpg' };

      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('should pass validation with empty media array but body present', async () => {
      const dto = new PostRequestDto();
      dto.platform = 'telegram';
      dto.body = 'Test post';
      dto.media = [];

      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('should pass validation with false in media fields and body present', async () => {
      const dto = new PostRequestDto();
      dto.platform = 'telegram';
      dto.body = 'Test post';
      dto.cover = false as any;
      dto.video = false as any;
      dto.audio = false as any;
      dto.document = false as any;

      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('should pass validation with false in some media fields and valid media in others', async () => {
      const dto = new PostRequestDto();
      dto.platform = 'telegram';
      dto.cover = false as any;
      dto.video = false as any;
      dto.audio = false as any;
      dto.document = false as any;
      dto.media = [
        { src: 'https://example.com/image1.jpg' },
        { src: 'https://example.com/image2.jpg' },
      ];

      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });
  });

  describe('Invalid cases', () => {
    it('should fail validation without body and without media', async () => {
      const dto = new PostRequestDto();
      dto.platform = 'telegram';

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);

      const hasContentError = errors.find(
        err =>
          err.constraints &&
          Object.values(err.constraints).some(msg =>
            msg.includes('body text or at least one media field'),
          ),
      );
      expect(hasContentError).toBeDefined();
    });

    it('should fail validation with empty body and no media', async () => {
      const dto = new PostRequestDto();
      dto.platform = 'telegram';
      dto.body = '';

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('should fail validation with whitespace-only body and no media', async () => {
      const dto = new PostRequestDto();
      dto.platform = 'telegram';
      dto.body = '   ';

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('should fail validation with empty media array and no body', async () => {
      const dto = new PostRequestDto();
      dto.platform = 'telegram';
      dto.media = [];

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });
  });
});
