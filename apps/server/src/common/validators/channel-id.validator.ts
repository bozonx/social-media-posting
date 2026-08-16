import {
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

/**
 * Structural check for `channelId`: a non-empty string or an integer.
 *
 * What a given network considers a *valid* channel identifier is that
 * platform's business, and is checked by its `validateExtra()` hook against its
 * capability descriptor. This layer only rejects shapes no platform could use.
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
 * Decorator applying the structural `channelId` check to a DTO property.
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
