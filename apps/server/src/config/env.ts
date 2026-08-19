import { serverConfigSchema, type ServerConfig } from './schema.js';
import type { LogLevel } from '../logger.js';

/**
 * Environment the shell reads.
 *
 * A plain record rather than `process.env`, because Workers hands bindings to
 * the request handler instead of putting them on a global.
 */
export interface ServerEnv {
  LISTEN_HOST?: string;
  LISTEN_PORT?: string;
  BASE_PATH?: string;
  LOG_LEVEL?: string;
  AUTH_BEARER_TOKENS?: string;
  ALLOW_INLINE_AUTH?: string;
  INCLUDE_RAW_RESPONSES?: string;
  MAX_REQUEST_BODY_BYTES?: string;
  SHUTDOWN_DRAIN_SECONDS?: string;
  SERVICE_NAME?: string;
  SERVICE_VERSION?: string;
  /** The whole configuration as JSON. The only way to configure a Workers deploy. */
  CONFIG_JSON?: string;
  [key: string]: string | undefined;
}

/** Runtime settings derived from the environment. */
export interface RuntimeOptions {
  host: string;
  port: number;
  basePath: string;
  logLevel: LogLevel;
  authBearerTokens: string[];
  allowInlineAuth: boolean;
  includeRawResponses: boolean;
  maxRequestBodyBytes: number;
  shutdownDrainSeconds: number;
  serviceName: string;
  serviceVersion: string;
}

const LOG_LEVELS = new Set(['debug', 'info', 'warn', 'error', 'silent']);

/**
 * Read runtime settings out of the environment, applying defaults.
 * @param env - The environment record.
 */
export function readRuntimeOptions(env: ServerEnv): RuntimeOptions {
  const level = env.LOG_LEVEL ?? 'warn';

  return {
    host: env.LISTEN_HOST ?? '0.0.0.0',
    port: toInteger(env.LISTEN_PORT, 8080),
    basePath: normalizeBasePath(env.BASE_PATH),
    logLevel: (LOG_LEVELS.has(level) ? level : 'warn') as LogLevel,
    authBearerTokens: (env.AUTH_BEARER_TOKENS ?? '')
      .split(',')
      .map(token => token.trim())
      .filter(token => token.length > 0),
    allowInlineAuth: toBoolean(env.ALLOW_INLINE_AUTH, false),
    includeRawResponses: toBoolean(env.INCLUDE_RAW_RESPONSES, false),
    maxRequestBodyBytes: toBoundedInteger(env.MAX_REQUEST_BODY_BYTES, 1_048_576, 1_024, 10_485_760),
    shutdownDrainSeconds: toInteger(env.SHUTDOWN_DRAIN_SECONDS, 5),
    serviceName: nonEmpty(env.SERVICE_NAME) ?? 'social-posting-server',
    serviceVersion: nonEmpty(env.SERVICE_VERSION) ?? 'dev',
  };
}

/**
 * Read the platform configuration from `CONFIG_JSON`.
 *
 * This is how a Workers deploy is configured: it has no filesystem, so the YAML
 * file the Node deploy reads is not available there.
 *
 * @param env - The environment record.
 * @returns The parsed configuration, or undefined when the variable is unset.
 */
export function readConfigFromEnv(env: ServerEnv): ServerConfig | undefined {
  if (!env.CONFIG_JSON) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(env.CONFIG_JSON);
  } catch (error) {
    throw new Error(`CONFIG_JSON is not valid JSON: ${(error as Error).message}`, { cause: error });
  }

  return serverConfigSchema.parse(parsed);
}

/** Strip leading and trailing slashes so a base path composes cleanly. */
export function normalizeBasePath(basePath: string | undefined): string {
  return (basePath ?? '').trim().replace(/^\/+|\/+$/g, '');
}

/** Build the global API prefix: `{basePath}/api/v1`, or `api/v1` without one. */
export function buildApiPrefix(basePath: string | undefined): string {
  const normalized = normalizeBasePath(basePath);
  return normalized ? `${normalized}/api/v1` : 'api/v1';
}

function toInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toBoundedInteger(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = toInteger(value, fallback);
  return parsed >= min && parsed <= max ? parsed : fallback;
}

function toBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}
