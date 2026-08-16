import { IsInt, IsString, IsObject, IsOptional, Min, Max, validateSync } from 'class-validator';
import { plainToClass } from 'class-transformer';

/**
 * Account configuration validation class
 * Validates the structure and values of account configurations
 */
class AccountConfigValidationDto {
  /**
   * Platform name
   * Must be a non-empty string
   */
  @IsString()
  platform!: string;

  /**
   * Authentication configuration
   * Optional, must be an object if present
   */
  @IsOptional()
  @IsObject()
  auth?: Record<string, any>;

  /**
   * Maximum body length for this account (characters)
   * Optional, must be between 1 and 500000
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500000)
  maxBody?: number;

  /**
   * Platform-specific channel/chat identifier
   */
  @IsOptional()
  channelId?: string | number;
}

/**
 * YAML configuration validation class
 * Validates the structure and values from config.yaml
 */
export class YamlConfigDto {
  /**
   * Request timeout in seconds
   * Must be between 1 and 600 (10 minutes)
   */
  @IsInt()
  @Min(1)
  @Max(600)
  requestTimeoutSecs: number = 60;

  /**
   * Number of retry attempts on error
   * Must be between 0 and 10
   */
  @IsInt()
  @Min(0)
  @Max(10)
  retryAttempts: number = 3;

  /**
   * Delay between retry attempts in milliseconds
   * Must be between 0 and 60000 (1 minute)
   */
  @IsInt()
  @Min(0)
  @Max(60000)
  retryDelayMs: number = 1000;

  /**
   * Named account configurations
   */
  @IsOptional()
  @IsObject()
  accounts: Record<string, any> = {};
}

/**
 * Validates YAML configuration object
 * @param config - Raw configuration object from YAML file
 * @throws Error if validation fails
 * @returns Validated configuration object
 */
export function validateYamlConfig(config: any): YamlConfigDto {
  const dto = plainToClass(YamlConfigDto, config);

  const errors = validateSync(dto, {
    skipMissingProperties: false,
    whitelist: false, // Allow additional properties in accounts
  });

  const errorMessages: string[] = [];

  if (errors.length > 0) {
    for (const err of errors) {
      const constraints = err.constraints ? Object.values(err.constraints).join(', ') : '';
      errorMessages.push(`${err.property}: ${constraints}`);
    }
  }

  const accountErrorMessages: string[] = [];

  if (dto.accounts && typeof dto.accounts === 'object') {
    for (const [accountName, accountConfig] of Object.entries(dto.accounts)) {
      const accountDto = plainToClass(AccountConfigValidationDto, accountConfig);
      const accountErrors = validateSync(accountDto, {
        skipMissingProperties: false,
        whitelist: false,
      });

      if (accountErrors.length > 0) {
        const constraints = accountErrors
          .map(err => {
            const msg = err.constraints ? Object.values(err.constraints).join(', ') : '';
            return `${err.property}: ${msg}`;
          })
          .join('; ');

        accountErrorMessages.push(`account "${accountName}": ${constraints}`);
      }
    }
  }

  const allErrors = [...errorMessages, ...accountErrorMessages];

  if (allErrors.length > 0) {
    throw new Error(`YAML config validation error: ${allErrors.join('; ')}`);
  }

  return dto;
}
