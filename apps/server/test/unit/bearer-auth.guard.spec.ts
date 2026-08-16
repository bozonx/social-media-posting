import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { BearerAuthGuard } from '../../src/common/guards/bearer-auth.guard.js';

describe('BearerAuthGuard', () => {
  let guard: BearerAuthGuard;
  let reflector: Reflector;
  let configService: ConfigService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BearerAuthGuard,
        {
          provide: Reflector,
          useValue: {
            getAllAndOverride: vi.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: vi.fn(),
          },
        },
      ],
    }).compile();

    guard = module.get<BearerAuthGuard>(BearerAuthGuard);
    reflector = module.get<Reflector>(Reflector);
    configService = module.get<ConfigService>(ConfigService);
  });

  const createMockContext = (authHeader?: string): ExecutionContext => {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          headers: {
            authorization: authHeader,
          },
        }),
      }),
      getHandler: vi.fn(),
      getClass: vi.fn(),
    } as unknown as ExecutionContext;
  };

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  it('should allow public routes', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
    const context = createMockContext();

    expect(guard.canActivate(context)).toBe(true);
  });

  it('should allow all routes if no tokens are configured', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    vi.spyOn(configService, 'get').mockReturnValue({});
    const context = createMockContext();

    expect(guard.canActivate(context)).toBe(true);
  });

  it('should throw UnauthorizedException if header is missing', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    vi.spyOn(configService, 'get').mockReturnValue({ authBearerTokens: ['token1'] });
    const context = createMockContext();

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(context)).toThrow('Authorization header is missing');
  });

  it('should throw UnauthorizedException if format is invalid', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    vi.spyOn(configService, 'get').mockReturnValue({ authBearerTokens: ['token1'] });
    const context = createMockContext('Invalid token1');

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(context)).toThrow('Invalid authorization format');
  });

  it('should throw UnauthorizedException if token is incorrect', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    vi.spyOn(configService, 'get').mockReturnValue({ authBearerTokens: ['token1'] });
    const context = createMockContext('Bearer wrong-token');

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(context)).toThrow('Invalid Bearer token');
  });

  it('should allow access if token is correct', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    vi.spyOn(configService, 'get').mockReturnValue({ authBearerTokens: ['token1', 'token2'] });
    const context = createMockContext('Bearer token2');

    expect(guard.canActivate(context)).toBe(true);
  });
});
