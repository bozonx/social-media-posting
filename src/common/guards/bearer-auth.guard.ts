import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import type { AppConfig } from '../../config/app.config.js';

/**
 * Guard that implements Bearer token authentication
 * Checks the Authorization header for a matching Bearer token
 * Bypasses check if the route is marked with @Public()
 */
@Injectable()
export class BearerAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Determines if the request is authorized
   * @param context - Execution context
   * @returns boolean indicating if the request is authorized
   * @throws UnauthorizedException if authentication fails
   */
  public canActivate(context: ExecutionContext): boolean {
    // Check if the route is marked as public
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const appConfig = this.configService.get<AppConfig>('app')!;
    const allowedTokens = appConfig.authBearerTokens;

    // If no tokens are configured, authentication is disabled
    if (!allowedTokens || allowedTokens.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    if (!authHeader) {
      throw new UnauthorizedException('Authorization header is missing');
    }

    const [type, token] = authHeader.split(' ');

    if (type !== 'Bearer' || !token) {
      throw new UnauthorizedException('Invalid authorization format. Expected: Bearer <token>');
    }

    if (!allowedTokens.includes(token)) {
      throw new UnauthorizedException('Invalid Bearer token');
    }

    return true;
  }
}
