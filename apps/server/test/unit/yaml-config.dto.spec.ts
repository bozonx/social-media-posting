import { describe, expect, it } from 'vitest';
import 'reflect-metadata';
import { validateYamlConfig, YamlConfigDto } from '../../src/config/yaml-config.dto.js';

describe('YamlConfigDto', () => {
  describe('validateYamlConfig', () => {
    it('should validate a correct configuration', () => {
      const config = {
        requestTimeoutSecs: 60,

        accounts: {
          test_channel: {
            platform: 'telegram',
            auth: {
              apiKey: 'test_token',
              chatId: '@test',
            },
          },
        },
      };

      const result = validateYamlConfig(config);
      expect(result).toBeInstanceOf(YamlConfigDto);
      expect(result.requestTimeoutSecs).toBe(60);
    });

    it('should reject requestTimeoutSecs below minimum', () => {
      const config = {
        requestTimeoutSecs: 0,
        accounts: {},
      };

      expect(() => validateYamlConfig(config)).toThrow(/requestTimeoutSecs/);
    });

    it('should reject requestTimeoutSecs above maximum', () => {
      const config = {
        requestTimeoutSecs: 601,

        accounts: {},
      };

      expect(() => validateYamlConfig(config)).toThrow(/requestTimeoutSecs/);
    });

    it('should apply default values for missing fields', () => {
      const config = {
        // Empty config or partial config
      };

      const result = validateYamlConfig(config);

      expect(result).toBeInstanceOf(YamlConfigDto);
      expect(result.requestTimeoutSecs).toBe(60);
      expect(result.accounts).toEqual({});
    });

    it('should accept edge case values', () => {
      const config = {
        requestTimeoutSecs: 1, // Min

        accounts: {},
      };

      const result = validateYamlConfig(config);
      expect(result.requestTimeoutSecs).toBe(1);
    });

    it('should accept maximum edge case values', () => {
      const config = {
        requestTimeoutSecs: 600, // Max

        accounts: {},
      };

      const result = validateYamlConfig(config);
      expect(result.requestTimeoutSecs).toBe(600);
    });

    it('should reject channel without platform field', () => {
      const config = {
        requestTimeoutSecs: 60,
        accounts: {
          broken_channel: {
            // Missing platform
            auth: {
              apiKey: 'test',
            },
          },
        },
      };

      expect(() => validateYamlConfig(config)).toThrow(
        /YAML config validation error: .*broken_channel/i,
      );
    });

    it('should reject channel with non-string platform', () => {
      const config = {
        requestTimeoutSecs: 60,
        accounts: {
          broken_channel: {
            platform: 123,
            auth: {
              apiKey: 'test',
            },
          },
        },
      };

      expect(() => validateYamlConfig(config)).toThrow(
        /YAML config validation error: .*broken_channel/i,
      );
    });

    it('should validate account with maxBody', () => {
      const config = {
        requestTimeoutSecs: 60,
        accounts: {
          test_channel: {
            platform: 'telegram',
            auth: { apiKey: 'test' },
            maxBody: 100000,
          },
        },
      };

      const result = validateYamlConfig(config);
      expect(result.accounts.test_channel.maxBody).toBe(100000);
    });

    it('should reject account with maxBody below minimum', () => {
      const config = {
        requestTimeoutSecs: 60,
        accounts: {
          test_channel: {
            platform: 'telegram',
            auth: { apiKey: 'test' },
            maxBody: 0,
          },
        },
      };

      expect(() => validateYamlConfig(config)).toThrow(/test_channel/);
    });

    it('should reject account with maxBody above maximum', () => {
      const config = {
        requestTimeoutSecs: 60,
        accounts: {
          test_channel: {
            platform: 'telegram',
            auth: { apiKey: 'test' },
            maxBody: 500001,
          },
        },
      };

      expect(() => validateYamlConfig(config)).toThrow(/test_channel/);
    });
  });
});
