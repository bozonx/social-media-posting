import { afterEach, describe, expect, it, vi } from 'vitest';
import { JsonLogger } from '../../src/logger.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('JsonLogger', () => {
  it('writes one JSON line per event', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    new JsonLogger('debug', 'posting').warn('something happened', 'PostService');

    expect(JSON.parse(spy.mock.calls[0][0] as string)).toMatchObject({
      level: 'warn',
      service: 'posting',
      context: 'PostService',
      message: 'something happened',
    });
  });

  it('drops events below the configured level', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    const logger = new JsonLogger('error');
    logger.debug('quiet');
    logger.log('quiet');
    logger.error('loud');

    expect(log).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('says nothing at all when silenced', () => {
    const spies = [
      vi.spyOn(console, 'log').mockImplementation(() => {}),
      vi.spyOn(console, 'warn').mockImplementation(() => {}),
      vi.spyOn(console, 'error').mockImplementation(() => {}),
    ];

    const logger = new JsonLogger('silent');
    logger.log('x');
    logger.warn('x');
    logger.error('x');

    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
    }
  });

  it('carries a stack trace on errors', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    new JsonLogger('debug').error('boom', 'Error: boom\n  at somewhere');

    expect(JSON.parse(spy.mock.calls[0][0] as string).trace).toContain('at somewhere');
  });
});
