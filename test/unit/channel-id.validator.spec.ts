import { describe, it, expect, beforeEach } from '@jest/globals';
import { IsChannelIdConstraint } from '@/common/validators/channel-id.validator.js';
import type { ValidationArguments } from 'class-validator';

describe('IsChannelIdConstraint', () => {
  let validator: IsChannelIdConstraint;
  const mockArgs = {} as ValidationArguments;

  beforeEach(() => {
    validator = new IsChannelIdConstraint();
  });

  describe('validate', () => {
    it('should return true for null/undefined (optional field)', () => {
      expect(validator.validate(null, mockArgs)).toBe(true);
      expect(validator.validate(undefined, mockArgs)).toBe(true);
    });

    it('should return true for valid string channel IDs', () => {
      expect(validator.validate('@mychannel', mockArgs)).toBe(true);
      expect(validator.validate('-100123456789', mockArgs)).toBe(true);
      expect(validator.validate('123456789', mockArgs)).toBe(true);
    });

    it('should return true for valid numeric channel IDs', () => {
      expect(validator.validate(123456789, mockArgs)).toBe(true);
      expect(validator.validate(-100123456789, mockArgs)).toBe(true);
    });

    it('should return false for empty string', () => {
      expect(validator.validate('', mockArgs)).toBe(false);
      expect(validator.validate('   ', mockArgs)).toBe(false);
    });

    it('should return false for non-integer numbers', () => {
      expect(validator.validate(123.456, mockArgs)).toBe(false);
      expect(validator.validate(NaN, mockArgs)).toBe(false);
      expect(validator.validate(Infinity, mockArgs)).toBe(false);
    });

    it('should return false for invalid types', () => {
      expect(validator.validate(true, mockArgs)).toBe(false);
      expect(validator.validate(false, mockArgs)).toBe(false);
      expect(validator.validate({}, mockArgs)).toBe(false);
      expect(validator.validate([], mockArgs)).toBe(false);
    });
  });

  describe('defaultMessage', () => {
    it('should return correct error message', () => {
      expect(validator.defaultMessage(mockArgs)).toBe(
        'channelId must be a non-empty string or an integer number',
      );
    });
  });
});
