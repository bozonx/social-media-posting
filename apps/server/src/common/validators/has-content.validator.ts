import {
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

/**
 * Validator constraint for ensuring post has content
 * Checks that either body or at least one media field is provided
 */
@ValidatorConstraint({ name: 'hasContent', async: false })
export class HasContentConstraint implements ValidatorConstraintInterface {
  /**
   * Validates that post has either body or media content
   * @param _value - Not used (class-level validator)
   * @param args - Validation arguments containing the object
   * @returns True if valid, false otherwise
   */
  validate(_value: any, args: ValidationArguments) {
    const obj = args.object as any;

    // Check if body is a non-empty string
    const hasBody = typeof obj.body === 'string' && obj.body.trim().length > 0;

    // Check if at least one media field is provided (ignore falsy values like false, null, undefined, '')
    const hasMedia =
      (obj.cover && typeof obj.cover === 'object') ||
      (obj.video && typeof obj.video === 'object') ||
      (obj.audio && typeof obj.audio === 'object') ||
      (obj.document && typeof obj.document === 'object') ||
      (Array.isArray(obj.media) && obj.media.length > 0);

    return hasBody || hasMedia;
  }

  defaultMessage(_args: ValidationArguments) {
    return 'Post must have either body text or at least one media field (cover, video, audio, document, or media)';
  }
}

/**
 * Decorator factory for content validation
 * Validates that post has either body or media content
 * This is a class-level decorator
 * @param validationOptions - Optional validation options
 * @returns Class decorator
 */
export function HasContent(validationOptions?: ValidationOptions) {
  return function (object: Function) {
    registerDecorator({
      target: object,
      propertyName: '',
      options: validationOptions,
      constraints: [],
      validator: HasContentConstraint,
    });
  };
}
