import type { ILogger } from '@bozonx/social-posting';

/** Levels the shell's logger understands, from most to least verbose. */
const LEVELS = ['debug', 'info', 'warn', 'error', 'silent'] as const;
export type LogLevel = (typeof LEVELS)[number];

/**
 * Structured logger for the HTTP shell.
 *
 * One line of JSON per event, written with `console`, because that is the only
 * logging primitive every target runtime shares. Pino is Node-only and would
 * have made the Workers build impossible.
 */
export class JsonLogger implements ILogger {
  private readonly threshold: number;

  constructor(
    level: LogLevel = 'warn',
    private readonly service = 'social-posting-server',
  ) {
    this.threshold = LEVELS.indexOf(level);
  }

  debug(message: string, context?: string): void {
    this.write('debug', message, context);
  }

  log(message: string, context?: string): void {
    this.write('info', message, context);
  }

  warn(message: string, context?: string): void {
    this.write('warn', message, context);
  }

  error(message: string, trace?: string, context?: string): void {
    this.write('error', message, context, trace);
  }

  private write(level: LogLevel, message: string, context?: string, trace?: string): void {
    if (LEVELS.indexOf(level) < this.threshold) {
      return;
    }

    const line = JSON.stringify({
      level,
      '@timestamp': new Date().toISOString(),
      service: this.service,
      context,
      message,
      trace,
    });

    if (level === 'error') {
      console.error(line);
    } else if (level === 'warn') {
      console.warn(line);
    } else {
      console.log(line);
    }
  }
}
