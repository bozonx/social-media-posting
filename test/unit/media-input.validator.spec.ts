import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  IsMediaInputConstraint,
  IsMediaInputArrayConstraint,
} from '@/common/validators/media-input.validator.js';
import type { ValidationArguments } from 'class-validator';

describe('IsMediaInputConstraint', () => {
  let validator: IsMediaInputConstraint;
  const mockArgs = {} as ValidationArguments;

  beforeEach(() => {
    validator = new IsMediaInputConstraint();
  });

  describe('validate', () => {
    it('should return true for null/undefined/false (optional field)', () => {
      expect(validator.validate(null, mockArgs)).toBe(true);
      expect(validator.validate(undefined, mockArgs)).toBe(true);
      expect(validator.validate(false, mockArgs)).toBe(true);
    });

    it('should return true for object with src (url)', () => {
      expect(validator.validate({ src: 'https://example.com/image.jpg' }, mockArgs)).toBe(true);
    });

    it('should return true for object with src (fileId)', () => {
      expect(validator.validate({ src: 'AgACAgIAAxkBAAIC...' }, mockArgs)).toBe(true);
    });

    it('should return true for object with hasSpoiler boolean', () => {
      expect(
        validator.validate({ src: 'https://example.com/image.jpg', hasSpoiler: true }, mockArgs),
      ).toBe(true);
      expect(
        validator.validate({ src: 'https://example.com/image.jpg', hasSpoiler: false }, mockArgs),
      ).toBe(true);
    });

    it('should return true for object with type string', () => {
      expect(
        validator.validate({ src: 'https://example.com/image.jpg', type: 'image' }, mockArgs),
      ).toBe(true);
    });

    it('should return false for object without src', () => {
      expect(validator.validate({}, mockArgs)).toBe(false);
      expect(validator.validate({ hasSpoiler: true }, mockArgs)).toBe(false);
    });

    it('should return false for object with non-boolean hasSpoiler', () => {
      expect(
        validator.validate({ src: 'https://example.com/image.jpg', hasSpoiler: 'true' }, mockArgs),
      ).toBe(false);
      expect(
        validator.validate({ src: 'https://example.com/image.jpg', hasSpoiler: 1 }, mockArgs),
      ).toBe(false);
    });

    it('should return false for object with non-string type', () => {
      expect(
        validator.validate({ src: 'https://example.com/image.jpg', type: 123 }, mockArgs),
      ).toBe(false);
    });

    it('should return false for non-object values', () => {
      expect(validator.validate('https://example.com/image.jpg', mockArgs)).toBe(false);
      expect(validator.validate(123, mockArgs)).toBe(false);
      expect(validator.validate(true, mockArgs)).toBe(false);
      expect(validator.validate([], mockArgs)).toBe(false);
    });

    it('should return false for object with src exceeding max length', () => {
      const longUrl = 'https://example.com/' + 'a'.repeat(500);
      expect(validator.validate({ src: longUrl }, mockArgs)).toBe(false);
    });

    it('should return true for object with src at max length (500 chars)', () => {
      const maxLengthUrl = 'https://example.com/' + 'a'.repeat(480);
      expect(validator.validate({ src: maxLengthUrl }, mockArgs)).toBe(true);
    });

    it('should return false for object with empty src', () => {
      expect(validator.validate({ src: '' }, mockArgs)).toBe(false);
    });
  });

  describe('defaultMessage', () => {
    it('should return correct error message', () => {
      expect(validator.defaultMessage(mockArgs)).toBe(
        'MediaInput must be an object with src (max 500 characters), optional hasSpoiler boolean, and optional type string',
      );
    });
  });
});

describe('IsMediaInputArrayConstraint', () => {
  let validator: IsMediaInputArrayConstraint;
  const mockArgs = {} as ValidationArguments;

  beforeEach(() => {
    validator = new IsMediaInputArrayConstraint();
  });

  describe('validate', () => {
    it('should return true for null/undefined (optional field)', () => {
      expect(validator.validate(null, mockArgs)).toBe(true);
      expect(validator.validate(undefined, mockArgs)).toBe(true);
    });

    it('should return true for array of valid objects', () => {
      expect(
        validator.validate(
          [
            { src: 'https://example.com/1.jpg' },
            { src: 'AgACAgIAAxkBAAIC...' },
            { src: 'https://example.com/3.jpg', hasSpoiler: true },
          ],
          mockArgs,
        ),
      ).toBe(true);
    });

    it('should return true for array of objects with type', () => {
      expect(
        validator.validate(
          [
            { src: 'https://example.com/1.jpg', type: 'image' },
            { src: 'https://example.com/2.mp4', type: 'video' },
          ],
          mockArgs,
        ),
      ).toBe(true);
    });

    it('should return true for empty array', () => {
      expect(validator.validate([], mockArgs)).toBe(true);
    });

    it('should return false for non-array', () => {
      expect(validator.validate('https://example.com/image.jpg', mockArgs)).toBe(false);
      expect(validator.validate({ src: 'https://example.com/image.jpg' }, mockArgs)).toBe(false);
    });

    it('should return false if any item is invalid', () => {
      expect(validator.validate([{ src: 'https://example.com/1.jpg' }, ''], mockArgs)).toBe(false);
      expect(validator.validate([{ src: 'https://example.com/1.jpg' }, {}], mockArgs)).toBe(false);
      expect(validator.validate([{ src: 'https://example.com/1.jpg' }, 123], mockArgs)).toBe(false);
    });

    it('should return false for array with string items', () => {
      expect(
        validator.validate(['https://example.com/1.jpg', 'https://example.com/2.jpg'], mockArgs),
      ).toBe(false);
    });
  });

  describe('defaultMessage', () => {
    it('should return correct error message', () => {
      expect(validator.defaultMessage(mockArgs)).toBe(
        'Property "media" must be an array of objects. Example: [{"src": "https://example.com/image.jpg", "type": "image"}]. Each item must have src (max 500 characters), optional hasSpoiler boolean, and optional type string',
      );
    });
  });
});
