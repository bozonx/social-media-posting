import type { ILogger } from '@bozonx/social-posting';
import type { PinoLogger } from 'nestjs-pino';

/**
 * Adapts the application's Pino logger to the core's {@link ILogger} port.
 *
 * The core never reaches for an ambient logger; the shell hands it this one.
 */
export class PinoLoggerAdapter implements ILogger {
  constructor(private readonly pino: PinoLogger) {}

  debug(message: string, context?: string): void {
    this.pino.debug({ context }, message);
  }

  log(message: string, context?: string): void {
    this.pino.info({ context }, message);
  }

  warn(message: string, context?: string): void {
    this.pino.warn({ context }, message);
  }

  error(message: string, trace?: string, context?: string): void {
    this.pino.error({ context, trace }, message);
  }
}
