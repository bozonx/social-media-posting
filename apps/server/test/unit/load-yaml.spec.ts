import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadYamlConfig } from '../../src/config/load-yaml.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'posting-config-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.TEST_BOT_TOKEN;
});

function writeConfig(contents: string): string {
  const path = join(dir, 'config.yaml');
  writeFileSync(path, contents, 'utf8');
  return path;
}

describe('loadYamlConfig', () => {
  it('reads accounts and settings', () => {
    const path = writeConfig(`
requestTimeoutSecs: 30
accounts:
  main:
    platform: telegram
    auth:
      apiKey: static-token
    channelId: '@channel'
`);

    expect(loadYamlConfig(path)).toMatchObject({
      requestTimeoutSecs: 30,
      accounts: { main: { platform: 'telegram', channelId: '@channel' } },
    });
  });

  it('substitutes environment variables', () => {
    process.env.TEST_BOT_TOKEN = 'from-env';
    const path = writeConfig(`
accounts:
  main:
    platform: telegram
    auth:
      apiKey: \${TEST_BOT_TOKEN}
`);

    expect(loadYamlConfig(path).accounts.main.auth).toEqual({ apiKey: 'from-env' });
  });

  it('fails loudly when a referenced variable is missing', () => {
    const path = writeConfig(`
accounts:
  main:
    platform: telegram
    auth:
      apiKey: \${DEFINITELY_NOT_SET}
`);

    expect(() => loadYamlConfig(path)).toThrow(/DEFINITELY_NOT_SET is not defined/);
  });

  it('starts on defaults when the file is absent', () => {
    expect(loadYamlConfig(join(dir, 'missing.yaml'))).toEqual({
      requestTimeoutSecs: 60,
      accounts: {},
    });
  });

  it('rejects a configuration that does not validate', () => {
    const path = writeConfig('requestTimeoutSecs: 100000\n');

    expect(() => loadYamlConfig(path)).toThrow(/Failed to load config/);
  });

  it('keeps platform-specific account fields it does not know about', () => {
    const path = writeConfig(`
accounts:
  main:
    platform: telegram
    auth: {}
    apiTimeoutSeconds: 20
`);

    expect(loadYamlConfig(path).accounts.main).toMatchObject({ apiTimeoutSeconds: 20 });
  });
});
