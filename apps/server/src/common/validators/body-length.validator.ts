import {
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { MAX_BODY_LIMIT } from '@bozonx/social-posting';

/**
 * Validator constraint for body field with dynamic max length
 * Uses maxBody from request (capped at MAX_BODY_LIMIT)
 */
@ValidatorConstraint({ name: 'isValidBodyLength', async: false })
export class IsValidBodyLengthConstraint implements ValidatorConstraintInterface {
  /**
   * Validates body length against maxBody or MAX_BODY_LIMIT
   * @param value - Body string to validate
   * @param args - Validation arguments containing the object
   * @returns True if valid, false otherwise
   */
  validate(value: any, args: ValidationArguments) {
    if (typeof value !== 'string') {
      return false;
    }

    const obj = args.object as any;
    // Use maxBody from request if provided, otherwise use absolute limit
    const maxLength = Math.min(obj.maxBody || MAX_BODY_LIMIT, MAX_BODY_LIMIT);

    return value.length <= maxLength;
  }

  defaultMessage(args: ValidationArguments) {
    const obj = args.object as any;
    const maxLength = Math.min(obj.maxBody || MAX_BODY_LIMIT, MAX_BODY_LIMIT);
    return `Body length must not exceed ${maxLength} characters`;
  }
}

/**
 * Decorator factory for body length validation
 * Validates body against maxBody parameter or default max length
 * @param validationOptions - Optional validation options
 * @returns Property decorator
 */
export function IsValidBodyLength(validationOptions?: ValidationOptions) {
  return function (object: Object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsValidBodyLengthConstraint,
    });
  };
}
