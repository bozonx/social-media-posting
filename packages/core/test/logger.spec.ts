import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConsoleLogger } from '../src/logger/logger.js';

describe('ConsoleLogger', () => {
  let debugSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('log levels filtering', () => {
    it('defaults to warn level and only logs warnings and errors', () => {
      const logger = new ConsoleLogger();

      logger.debug('debug msg');
      logger.log('info msg');
      logger.warn('warn msg');
      logger.error('error msg');

      expect(debugSpy).not.toHaveBeenCalled();
      expect(logSpy).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(' warn msg');
      expect(errorSpy).toHaveBeenCalledWith(' error msg');
    });

    it('logs all messages when level is debug', () => {
      const logger = new ConsoleLogger('debug');

      logger.debug('debug msg');
      logger.log('info msg');
      logger.warn('warn msg');
      logger.error('error msg');

      expect(debugSpy).toHaveBeenCalledWith(' debug msg');
      expect(logSpy).toHaveBeenCalledWith(' info msg');
      expect(warnSpy).toHaveBeenCalledWith(' warn msg');
      expect(errorSpy).toHaveBeenCalledWith(' error msg');
    });

    it('logs info, warn, and error when level is info', () => {
      const logger = new ConsoleLogger('info');

      logger.debug('debug msg');
      logger.log('info msg');
      logger.warn('warn msg');
      logger.error('error msg');

      expect(debugSpy).not.toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith(' info msg');
      expect(warnSpy).toHaveBeenCalledWith(' warn msg');
      expect(errorSpy).toHaveBeenCalledWith(' error msg');
    });

    it('only logs errors when level is error', () => {
      const logger = new ConsoleLogger('error');

      logger.debug('debug msg');
      logger.log('info msg');
      logger.warn('warn msg');
      logger.error('error msg');

      expect(debugSpy).not.toHaveBeenCalled();
      expect(logSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledWith(' error msg');
    });
  });

  describe('formatting with context', () => {
    it('prefixes messages with context when provided', () => {
      const logger = new ConsoleLogger('debug');

      logger.debug('debug msg', 'ContextA');
      logger.log('info msg', 'ContextB');
      logger.warn('warn msg', 'ContextC');
      logger.error('error msg', undefined, 'ContextD');

      expect(debugSpy).toHaveBeenCalledWith('[ContextA] debug msg');
      expect(logSpy).toHaveBeenCalledWith('[ContextB] info msg');
      expect(warnSpy).toHaveBeenCalledWith('[ContextC] warn msg');
      expect(errorSpy).toHaveBeenCalledWith('[ContextD] error msg');
    });

    it('logs stack trace for error when provided', () => {
      const logger = new ConsoleLogger('error');
      const trace = 'Error: something broke\n    at foo.ts:1:1';

      logger.error('failure', trace, 'MyService');

      expect(errorSpy).toHaveBeenCalledTimes(2);
      expect(errorSpy).toHaveBeenNthCalledWith(1, '[MyService] failure');
      expect(errorSpy).toHaveBeenNthCalledWith(2, trace);
    });

    it('does not log trace for error when trace is omitted', () => {
      const logger = new ConsoleLogger('error');

      logger.error('failure', undefined, 'MyService');

      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledWith('[MyService] failure');
    });
  });
});
