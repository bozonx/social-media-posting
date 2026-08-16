import { registerAs } from '@nestjs/config';
import { readFileSync } from 'fs';
import * as yaml from 'js-yaml';
import { join } from 'path';
import { validateYamlConfig } from './yaml-config.dto.js';

/**
 * Namespace for YAML configuration in NestJS ConfigService
 */
export const YAML_CONFIG_NAMESPACE = 'yaml_config';

/**
 * Recursively substitutes environment variables in configuration values
 * Supports ${VAR_NAME} syntax for variable interpolation
 * @param obj - Configuration object, array, or primitive value
 * @returns Processed value with environment variables substituted
 * @throws Error if a referenced environment variable is not defined
 */
const substituteEnvVariables = (obj: any): any => {
  if (typeof obj === 'string') {
    return obj.replace(/\$\{([^}]+)\}/g, (_, varName) => {
      const value = process.env[varName];
      if (value === undefined) {
        throw new Error(`Environment variable ${varName} is not defined`);
      }
      return value;
    });
  }

  if (Array.isArray(obj)) {
    return obj.map(item => substituteEnvVariables(item));
  }

  if (obj !== null && typeof obj === 'object') {
    const result: any = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = substituteEnvVariables(value);
    }
    return result;
  }

  return obj;
};

/**
 * Loads and parses YAML configuration file
 * Reads the file from CONFIG_PATH environment variable or default location
 * Automatically substitutes environment variables in the configuration
 * Validates the configuration structure and values
 * @returns Parsed and validated configuration object with environment variables resolved
 * @throws Error if the configuration file cannot be loaded, parsed, or validated
 */
export default registerAs(YAML_CONFIG_NAMESPACE, () => {
  const configPath = process.env.CONFIG_PATH || join(process.cwd(), 'config.yaml');

  try {
    let rawConfig: any = {};
    try {
      const fileContent = readFileSync(configPath, 'utf8');
      rawConfig = yaml.load(fileContent) || {};
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
      // If file doesn't exist, we use empty config to rely on defaults
      rawConfig = {};
    }

    const configWithEnv = substituteEnvVariables(rawConfig);

    // Validate configuration structure and values
    // plainToClass will apply default values from YamlConfigDto instance
    const validatedConfig = validateYamlConfig(configWithEnv);

    return validatedConfig;
  } catch (error: any) {
    throw new Error(`Failed to load config from ${configPath}: ${error.message}`);
  }
});
