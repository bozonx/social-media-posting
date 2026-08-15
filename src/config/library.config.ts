import {
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Min,
  Max,
  validateSync,
  IsIn,
} from 'class-validator';
import { plainToClass } from 'class-transformer';
import { AppConfigService } from '../modules/app-config/app-config.service.js';
import type { AccountConfig } from '../modules/app-config/interfaces/app-config.interface.js';

/**
 * Validatable configuration class for library mode
 */
export class LibraryConfigDto {
  /**
   * Named account configurations
   */
  @IsObject()
  accounts!: Record<string, any>;

  /**
   * Request timeout in seconds
   * Must be between 1 and 600 (10 minutes)
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(600)
  requestTimeoutSecs: number = 60;

  /**
   * Number of retry attempts on error
   * Must be between 0 and 10
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  retryAttempts: number = 3;

  /**
   * Delay between retry attempts in milliseconds
   * Must be between 0 and 60000 (1 minute)
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(60000)
  retryDelayMs: number = 1000;

  /**
   * Time-to-live for idempotency records in cache (minutes)
   * Must be between 1 and 1440 (24 hours)
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1440)
  idempotencyTtlMinutes: number = 10;

  /**
   * Logging level
   */
  @IsOptional()
  @IsIn(['debug', 'info', 'warn', 'error'])
  logLevel: 'debug' | 'info' | 'warn' | 'error' = 'warn';
}

/**
 * Account configuration validation class
 */
class AccountConfigValidationDto {
  @IsString()
  platform!: string;

  @IsOptional()
  @IsObject()
  auth?: Record<string, any>;

  @IsOptional()
  channelId?: string | number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500000)
  maxBody?: number;
}

/**
 * Library configuration service implementation
 * Validates provided config object and implements AppConfigService interface
 */
export class LibraryConfigService extends AppConfigService {
  private readonly config: LibraryConfigDto;

  constructor(config: any) {
    super();
    this.config = this.validate(config);
  }

  private validate(config: any): LibraryConfigDto {
    const dto = plainToClass(LibraryConfigDto, config);
    const errors = validateSync(dto, {
      skipMissingProperties: false,
      whitelist: true, // true here differs from YamlConfigDto false, but for library mode strict is probably better
    });

    const errorMessages: string[] = [];
    if (errors.length > 0) {
      for (const err of errors) {
        const constraints = err.constraints ? Object.values(err.constraints).join(', ') : '';
        errorMessages.push(`${err.property}: ${constraints}`);
      }
    }

    // Validate accounts manually
    const accountErrorMessages: string[] = [];
    if (dto.accounts && typeof dto.accounts === 'object') {
      for (const [accountName, accountConfig] of Object.entries(dto.accounts)) {
        const accountDto = plainToClass(AccountConfigValidationDto, accountConfig);
        const accountErrors = validateSync(accountDto);

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
    } else if (!errorMessages.some(e => e.includes('accounts'))) {
      // Only add this error if accounts is missing/invalid type was not already caught (but IsObject catches types)
      // Wait, if accounts is missing, 'validateSync' will catch it if I didn't make it optional?
      // I didn't make it optional in LibraryConfigDto, so it is required.
    }

    const allErrors = [...errorMessages, ...accountErrorMessages];
    if (allErrors.length > 0) {
      throw new Error(`Library config validation error: ${allErrors.join('; ')}`);
    }

    return dto;
  }

  get<T = any>(path: string): T | undefined {
    const keys = path.split('.');
    let value: any = this.config;

    for (const key of keys) {
      if (value === undefined || value === null) {
        return undefined;
      }
      value = value[key];
    }

    return value as T;
  }

  getAccount(accountName: string): AccountConfig {
    const account = this.config.accounts[accountName];
    if (!account) {
      throw new Error(`Account "${accountName}" not found in configuration`);
    }
    return account;
  }

  getAllAccounts(): Record<string, AccountConfig> {
    return this.config.accounts;
  }

  get requestTimeoutSecs(): number {
    return this.config.requestTimeoutSecs;
  }

  get retryAttempts(): number {
    return this.config.retryAttempts;
  }

  get retryDelayMs(): number {
    return this.config.retryDelayMs;
  }

  get idempotencyTtlMinutes(): number {
    return this.config.idempotencyTtlMinutes;
  }
}
