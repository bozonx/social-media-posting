import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as yaml from 'js-yaml';
import { serverConfigSchema, type ServerConfig } from './schema.js';

/**
 * Load `config.yaml`, substituting `${VAR}` references from the environment.
 *
 * Node-only, and deliberately so: this file is imported by the Node entry point
 * and never by the Workers one, which is configured through `CONFIG_JSON`.
 *
 * @param configPath - Path to the file; defaults to `CONFIG_PATH` or `./config.yaml`.
 * @returns The validated configuration; defaults when the file is absent.
 */
export function loadYamlConfig(configPath?: string): ServerConfig {
  const path = configPath ?? process.env.CONFIG_PATH ?? join(process.cwd(), 'config.yaml');

  try {
    let raw: unknown = {};
    try {
      raw = yaml.load(readFileSync(path, 'utf8')) ?? {};
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
      // No file: run on defaults, so a container without a mounted config still starts.
    }

    return serverConfigSchema.parse(substituteEnvVariables(raw));
  } catch (error) {
    throw new Error(`Failed to load config from ${path}: ${(error as Error).message}`, {
      cause: error,
    });
  }
}

/**
 * Replace `${VAR_NAME}` in every string value with the environment variable.
 * @throws Error naming the first variable that is not defined.
 */
function substituteEnvVariables(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(/\$\{([^}]+)\}/g, (_match, name: string) => {
      const resolved = process.env[name];
      if (resolved === undefined) {
        throw new Error(`Environment variable ${name} is not defined`);
      }
      return resolved;
    });
  }

  if (Array.isArray(value)) {
    return value.map(substituteEnvVariables);
  }

  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, substituteEnvVariables(item)]),
    );
  }

  return value;
}
