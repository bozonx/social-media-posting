import { SetMetadata } from '@nestjs/common';

/**
 * Key for the public metadata
 */
export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Decorator to mark a route as public
 * Routes marked with this decorator will bypass the BearerAuthGuard
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
