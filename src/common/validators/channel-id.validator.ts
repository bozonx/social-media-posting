import {
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

/**
 * Validator constraint for channelId field
 * Validates that channelId is either a string or a number
 * Allows formats like:
 * - String: "@mychannel", "-100123456789", "123456789"
 * - Number: 123456789, -100123456789
 */
@ValidatorConstraint({ name: 'isChannelId', async: false })
export class IsChannelIdConstraint implements ValidatorConstraintInterface {
  validate(value: any, args: ValidationArguments) {
    // Allow undefined/null for optional fields
    if (value === undefined || value === null) {
      return true;
    }

    // Check if it's a string or number
    if (typeof value === 'string') {
      // String must not be empty
      return value.trim().length > 0;
    }

    if (typeof value === 'number') {
      // Number must be a valid integer
      return Number.isInteger(value);
    }

    return false;
  }

  defaultMessage(args: ValidationArguments) {
    return 'channelId must be a non-empty string or an integer number';
  }
}

/**
 * Decorator factory for channelId validation
 * Use on DTO properties that accept channelId
 * @param validationOptions - Optional validation options
 * @returns Property decorator
 */
export function IsChannelId(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isChannelId',
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsChannelIdConstraint,
    });
  };
}
