import { registerAs } from '@nestjs/config';
import {
  IsInt,
  IsString,
  IsIn,
  Min,
  Max,
  IsOptional,
  IsArray,
  validateSync,
} from 'class-validator';
import { plainToClass } from 'class-transformer';

/**
 * Application configuration class
 * Validates environment variables and provides type-safe configuration
 */
export class AppConfig {
  /**
   * Port number for the HTTP server
   * Must be between 1 and 65535
   */
  @IsInt()
  @Min(1)
  @Max(65535)
  public port!: number;

  /**
   * Host address to bind the server to
   * Examples: 'localhost', '0.0.0.0', '127.0.0.1'
   */
  @IsString()
  public host!: string;

  /**
   * Base path for the application
   * If set, API will be available at {basePath}/api/v1
   */
  @IsString()
  public basePath!: string;

  /**
   * Node environment mode
   * Determines logging behavior and other environment-specific settings
   */
  @IsIn(['development', 'production', 'test'])
  public nodeEnv!: string;

  /**
   * Logging level for Pino logger
   * Controls the verbosity of application logs
   */
  @IsIn(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'])
  public logLevel!: string;

  /**
   * List of allowed Bearer tokens for API authentication
   */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  public authBearerTokens?: string[];

  @IsInt()
  @Min(0)
  public shutdownDrainSeconds!: number;
}

export default registerAs('app', (): AppConfig => {
  const authBearerTokens = process.env.AUTH_BEARER_TOKENS
    ? process.env.AUTH_BEARER_TOKENS.split(',')
        .map(token => token.trim())
        .filter(token => token.length > 0)
    : undefined;

  const config = plainToClass(AppConfig, {
    port: parseInt(process.env.LISTEN_PORT ?? '8080', 10),
    host: process.env.LISTEN_HOST ?? '0.0.0.0',
    basePath: (process.env.BASE_PATH ?? '').replace(/^\/+|\/+$/g, ''),
    nodeEnv: process.env.NODE_ENV ?? 'production',
    logLevel: process.env.LOG_LEVEL ?? 'warn',
    authBearerTokens,
    shutdownDrainSeconds: parseInt(process.env.SHUTDOWN_DRAIN_SECONDS ?? '5', 10),
  });

  const errors = validateSync(config, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    const errorMessages = errors.map(err => Object.values(err.constraints ?? {}).join(', '));
    throw new Error(`App config validation error: ${errorMessages.join('; ')}`);
  }

  return config;
});
