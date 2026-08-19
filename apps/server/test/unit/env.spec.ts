import { describe, expect, it } from 'vitest';
import {
  buildApiPrefix,
  normalizeBasePath,
  readConfigFromEnv,
  readRuntimeOptions,
} from '../../src/config/env.js';

describe('readRuntimeOptions', () => {
  it('applies defaults for an empty environment', () => {
    expect(readRuntimeOptions({})).toEqual({
      host: '0.0.0.0',
      port: 8080,
      basePath: '',
      logLevel: 'warn',
      authBearerTokens: [],
      allowInlineAuth: false,
      includeRawResponses: false,
      maxRequestBodyBytes: 1_048_576,
      shutdownDrainSeconds: 5,
      serviceName: 'social-posting-server',
      serviceVersion: 'dev',
    });
  });

  it('reads security controls only from explicit valid values', () => {
    expect(
      readRuntimeOptions({
        ALLOW_INLINE_AUTH: 'true',
        INCLUDE_RAW_RESPONSES: 'true',
        MAX_REQUEST_BODY_BYTES: '2048',
      }),
    ).toMatchObject({
      allowInlineAuth: true,
      includeRawResponses: true,
      maxRequestBodyBytes: 2048,
    });
    expect(readRuntimeOptions({ ALLOW_INLINE_AUTH: 'false' }).allowInlineAuth).toBe(false);
    expect(readRuntimeOptions({ ALLOW_INLINE_AUTH: 'yes' }).allowInlineAuth).toBe(false);
  });

  it('falls back to default maxRequestBodyBytes when value is out of bounds', () => {
    // Below 1024
    expect(readRuntimeOptions({ MAX_REQUEST_BODY_BYTES: '500' }).maxRequestBodyBytes).toBe(
      1_048_576,
    );
    // Above 10_485_760
    expect(readRuntimeOptions({ MAX_REQUEST_BODY_BYTES: '20000000' }).maxRequestBodyBytes).toBe(
      1_048_576,
    );
  });

  it('reads and trims service name and version, falling back when empty or whitespace', () => {
    expect(
      readRuntimeOptions({
        SERVICE_NAME: ' custom-service ',
        SERVICE_VERSION: ' 2.0.0 ',
      }),
    ).toMatchObject({
      serviceName: 'custom-service',
      serviceVersion: '2.0.0',
    });

    expect(
      readRuntimeOptions({
        SERVICE_NAME: '   ',
        SERVICE_VERSION: '',
      }),
    ).toMatchObject({
      serviceName: 'social-posting-server',
      serviceVersion: 'dev',
    });
  });

  it('splits and trims the bearer token list', () => {
    expect(readRuntimeOptions({ AUTH_BEARER_TOKENS: ' a , b ,, c ' }).authBearerTokens).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('falls back to warn for an unknown log level', () => {
    expect(readRuntimeOptions({ LOG_LEVEL: 'loud' }).logLevel).toBe('warn');
    expect(readRuntimeOptions({ LOG_LEVEL: 'debug' }).logLevel).toBe('debug');
  });

  it('falls back to the default port when it is not a number', () => {
    expect(readRuntimeOptions({ LISTEN_PORT: 'http' }).port).toBe(8080);
    expect(readRuntimeOptions({ LISTEN_PORT: '3000' }).port).toBe(3000);
  });
});

describe('base path', () => {
  it.each([
    [undefined, ''],
    ['', ''],
    ['/social/', 'social'],
    ['//social//', 'social'],
    ['  social  ', 'social'],
  ])('normalises %s', (input, expected) => {
    expect(normalizeBasePath(input)).toBe(expected);
  });

  it('builds the API prefix', () => {
    expect(buildApiPrefix(undefined)).toBe('api/v1');
    expect(buildApiPrefix('/social/')).toBe('social/api/v1');
  });
});

describe('readConfigFromEnv', () => {
  it('returns undefined when CONFIG_JSON is unset', () => {
    expect(readConfigFromEnv({})).toBeUndefined();
  });

  it('parses and validates CONFIG_JSON', () => {
    const config = readConfigFromEnv({
      CONFIG_JSON: JSON.stringify({
        requestTimeoutSecs: 30,
        accounts: { main: { platform: 'telegram', auth: { apiKey: 'k' } } },
      }),
    });

    expect(config).toMatchObject({
      requestTimeoutSecs: 30,
      accounts: { main: { platform: 'telegram' } },
    });
  });

  it('applies defaults for fields CONFIG_JSON omits', () => {
    expect(readConfigFromEnv({ CONFIG_JSON: '{}' })).toEqual({
      requestTimeoutSecs: 60,
      accounts: {},
    });
  });

  it('fails loudly on invalid JSON', () => {
    expect(() => readConfigFromEnv({ CONFIG_JSON: '{oops' })).toThrow(/not valid JSON/);
  });

  it('fails loudly on a configuration that does not validate', () => {
    expect(() =>
      readConfigFromEnv({ CONFIG_JSON: JSON.stringify({ requestTimeoutSecs: 100_000 }) }),
    ).toThrow();
  });
});
