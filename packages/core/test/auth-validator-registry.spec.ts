import { describe, expect, it, vi } from 'vitest';
import { AuthValidatorRegistry } from '../src/platforms/auth-validator-registry.js';
import { ErrorCode } from '../src/errors/error-code.js';
import { ValidationError } from '../src/errors/posting-error.js';
import { PlatformError } from '../src/errors/platform-error.js';
import type { IAuthValidator } from '../src/platforms/auth-validator.interface.js';

describe('AuthValidatorRegistry', () => {
  it('registers and checks validator existence case-insensitively', () => {
    const registry = new AuthValidatorRegistry();
    const validator: IAuthValidator = {
      providerName: 'Telegram',
      validate: () => ({ errors: [] }),
    };

    expect(registry.has('telegram')).toBe(false);
    expect(registry.has('Telegram')).toBe(false);

    registry.register(validator);

    expect(registry.has('telegram')).toBe(true);
    expect(registry.has('TELEGRAM')).toBe(true);
    expect(registry.has('other')).toBe(false);
  });

  it('accepts credentials as-is when no validator is registered for the platform', async () => {
    const registry = new AuthValidatorRegistry();

    await expect(registry.validate('custom-network', { token: 'any' })).resolves.toBeUndefined();
  });

  it('passes validation when the registered validator returns no errors', async () => {
    const registry = new AuthValidatorRegistry();
    const validateFn = vi.fn().mockReturnValue({ errors: [] });
    registry.register({ providerName: 'mock', validate: validateFn });

    const context = {
      capabilities: { name: 'mock', supportedTypes: [] },
      accountRef: 'main',
    };
    await registry.validate('mock', { apiKey: 'valid-key' }, context);

    expect(validateFn).toHaveBeenCalledWith({ apiKey: 'valid-key' }, context);
  });

  it('throws ValidationError when validator returns errors with no code or VALIDATION_ERROR code', async () => {
    const registry = new AuthValidatorRegistry();
    registry.register({
      providerName: 'mock',
      validate: () => ({ errors: ['apiKey is required', 'chatId is required'] }),
    });

    const error = await registry.validate('mock', {}).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).errors).toEqual(['apiKey is required', 'chatId is required']);
    expect((error as ValidationError).message).toBe('apiKey is required; chatId is required');
  });

  it('throws ValidationError when validator explicitly returns ErrorCode.VALIDATION_ERROR', async () => {
    const registry = new AuthValidatorRegistry();
    registry.register({
      providerName: 'mock',
      validate: () => ({
        errors: ['Invalid shape'],
        code: ErrorCode.VALIDATION_ERROR,
      }),
    });

    await expect(registry.validate('mock', {})).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws non-retryable PlatformError for AUTH_REFRESH_REQUIRED', async () => {
    const registry = new AuthValidatorRegistry();
    registry.register({
      providerName: 'oauth-platform',
      validate: () => ({
        errors: ['Token expired and refresh token is revoked'],
        code: ErrorCode.AUTH_REFRESH_REQUIRED,
      }),
    });

    const error = await registry.validate('oauth-platform', {}).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PlatformError);
    expect((error as PlatformError).code).toBe(ErrorCode.AUTH_REFRESH_REQUIRED);
    expect((error as PlatformError).retryable).toBe(false);
  });

  it('throws non-retryable PlatformError for AUTH_ERROR', async () => {
    const registry = new AuthValidatorRegistry();
    registry.register({
      providerName: 'oauth-platform',
      validate: () => ({
        errors: ['Invalid client credentials'],
        code: ErrorCode.AUTH_ERROR,
      }),
    });

    const error = await registry.validate('oauth-platform', {}).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PlatformError);
    expect((error as PlatformError).code).toBe(ErrorCode.AUTH_ERROR);
    expect((error as PlatformError).retryable).toBe(false);
  });

  it('throws retryable PlatformError for other platform error codes', async () => {
    const registry = new AuthValidatorRegistry();
    registry.register({
      providerName: 'oauth-platform',
      validate: () => ({
        errors: ['Auth service unavailable'],
        code: ErrorCode.NETWORK_ERROR,
      }),
    });

    const error = await registry.validate('oauth-platform', {}).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PlatformError);
    expect((error as PlatformError).code).toBe(ErrorCode.NETWORK_ERROR);
    expect((error as PlatformError).retryable).toBe(true);
  });
});
