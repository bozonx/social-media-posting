/**
 * Unit-test isolation: no test may reach the network.
 *
 * Localhost stays reachable so tests that spin up a local adapter still work.
 */
import { afterAll, afterEach, beforeAll } from 'vitest';
import nock from 'nock';

beforeAll(() => {
  nock.disableNetConnect();
  nock.enableNetConnect('127.0.0.1');
});

afterEach(() => {
  nock.cleanAll();
});

afterAll(() => {
  nock.enableNetConnect();
});
