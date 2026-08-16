/**
 * Logger interface for library mode
 * Allows users to provide their own logger implementation
 */
export interface ILogger {
  /**
   * Log debug message
   * @param message - Message to log
   * @param context - Optional context/source of the log
   */
  debug(message: string, context?: string): void;

  /**
   * Log informational message
   * @param message - Message to log
   * @param context - Optional context/source of the log
   */
  log(message: string, context?: string): void;

  /**
   * Log warning message
   * @param message - Message to log
   * @param context - Optional context/source of the log
   */
  warn(message: string, context?: string): void;

  /**
   * Log error message
   * @param message - Message to log
   * @param trace - Optional stack trace
   * @param context - Optional context/source of the log
   */
  error(message: string, trace?: string, context?: string): void;
}

/**
 * Simple console logger implementation
 * Used as default logger in library mode
 */
export class ConsoleLogger implements ILogger {
  constructor(private readonly logLevel: 'debug' | 'info' | 'warn' | 'error' = 'warn') {}

  private shouldLog(level: 'debug' | 'info' | 'warn' | 'error'): boolean {
    const levels = ['debug', 'info', 'warn', 'error'];
    const currentLevelIndex = levels.indexOf(this.logLevel);
    const messageLevelIndex = levels.indexOf(level);
    return messageLevelIndex >= currentLevelIndex;
  }

  debug(message: string, context?: string): void {
    if (this.shouldLog('debug')) {
      const prefix = context ? `[${context}]` : '';
      console.debug(`${prefix} ${message}`);
    }
  }

  log(message: string, context?: string): void {
    if (this.shouldLog('info')) {
      const prefix = context ? `[${context}]` : '';
      console.log(`${prefix} ${message}`);
    }
  }

  warn(message: string, context?: string): void {
    if (this.shouldLog('warn')) {
      const prefix = context ? `[${context}]` : '';
      console.warn(`${prefix} ${message}`);
    }
  }

  error(message: string, trace?: string, context?: string): void {
    if (this.shouldLog('error')) {
      const prefix = context ? `[${context}]` : '';
      console.error(`${prefix} ${message}`);
      if (trace) {
        console.error(trace);
      }
    }
  }
}
