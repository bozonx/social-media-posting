import {
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import type { MediaInput } from '@bozonx/social-posting';

/** Maximum length for URL and fileId strings */
const MAX_MEDIA_STRING_LENGTH = 500;

/**
 * Validator constraint for MediaInput type
 * Validates that a value is an object with src property
 */
@ValidatorConstraint({ name: 'isMediaInput', async: false })
export class IsMediaInputConstraint implements ValidatorConstraintInterface {
  /**
   * Validates MediaInput value
   * Accepts only an object with src property (max 500 characters)
   * @param value - Value to validate
   * @param args - Validation arguments
   * @returns True if valid, false otherwise
   */
  validate(value: any, args: ValidationArguments) {
    // Optional field - allow null/undefined/false
    if (value === null || value === undefined || value === false) {
      return true;
    }

    // Must be an object with src property
    if (typeof value === 'object' && value !== null) {
      const hasSrc = typeof value.src === 'string';
      const hasSpoiler = value.hasSpoiler === undefined || typeof value.hasSpoiler === 'boolean';
      const hasType = value.type === undefined || typeof value.type === 'string';

      // Validate string length
      if (hasSrc && value.src.length > MAX_MEDIA_STRING_LENGTH) {
        return false;
      }

      // Must have src, and hasSpoiler/type must be correct types if present
      return hasSrc && value.src.length > 0 && hasSpoiler && hasType;
    }

    return false;
  }

  defaultMessage(args: ValidationArguments) {
    return `MediaInput must be an object with src (max ${MAX_MEDIA_STRING_LENGTH} characters), optional hasSpoiler boolean, and optional type string`;
  }
}

/**
 * Decorator factory for MediaInput validation
 * Use on DTO properties that accept MediaInput type
 * @param validationOptions - Optional validation options
 * @returns Property decorator
 */
export function IsMediaInput(validationOptions?: ValidationOptions) {
  return function (object: Object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsMediaInputConstraint,
    });
  };
}

/**
 * Validator constraint for MediaInput array type
 * Validates that each item in the array is a valid MediaInput
 */
@ValidatorConstraint({ name: 'isMediaInputArray', async: false })
export class IsMediaInputArrayConstraint implements ValidatorConstraintInterface {
  /**
   * Validates array of MediaInput values
   * @param value - Array to validate
   * @param args - Validation arguments
   * @returns True if all items are valid MediaInput, false otherwise
   */
  validate(value: any, args: ValidationArguments) {
    if (!value) {
      return true; // Optional field
    }

    if (!Array.isArray(value)) {
      return false;
    }

    const validator = new IsMediaInputConstraint();
    return value.every(item => validator.validate(item, args));
  }

  defaultMessage(args: ValidationArguments) {
    return `Property "media" must be an array of objects. Example: [{"src": "https://example.com/image.jpg", "type": "image"}]. Each item must have src (max ${MAX_MEDIA_STRING_LENGTH} characters), optional hasSpoiler boolean, and optional type string`;
  }
}

/**
 * Decorator factory for MediaInput array validation
 * Use on DTO properties that accept MediaInput[] type
 * @param validationOptions - Optional validation options
 * @returns Property decorator
 */
export function IsMediaInputArray(validationOptions?: ValidationOptions) {
  return function (object: Object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsMediaInputArrayConstraint,
    });
  };
}
