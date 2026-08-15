import { BadRequestException, type Logger } from '@nestjs/common';
import { type AppConfigService } from '../app-config/app-config.service.js';
import { type PlatformRegistry } from '../platforms/base/platform-registry.service.js';
import { type AuthValidatorRegistry } from '../platforms/base/auth-validator-registry.service.js';
import { type IPlatform } from '../platforms/base/platform.interface.js';
import { type PostRequestDto } from './dto/index.js';
import type { AccountConfig } from '../app-config/interfaces/app-config.interface.js';

/**
 * Account configuration with inline auth support
 */
export interface ResolvedAccountConfig extends AccountConfig {
  /** Source of the config: 'account' or 'inline' */
  source: 'account' | 'inline';
}

/**
 * Base service with shared logic for PostService and PreviewService
 * Handles platform resolution, account config, and auth validation
 */
export abstract class BasePostService {
  protected abstract readonly logger: Logger;

  constructor(
    protected readonly appConfig: AppConfigService,
    protected readonly platformRegistry: PlatformRegistry,
    protected readonly authValidatorRegistry: AuthValidatorRegistry,
  ) {}

  /**
   * Get platform instance by name
   * @param platformName - Platform name (e.g., 'telegram')
   * @returns Platform instance
   * @throws BadRequestException if platform is not found
   */
  protected getPlatform(platformName: string): IPlatform {
    return this.platformRegistry.get(platformName);
  }

  /**
   * Get account configuration from request
   * Supports both named accounts from config and inline auth
   * @param request - Post request
   * @returns Account configuration object with source indicator
   * @throws BadRequestException if neither account nor auth is provided
   */
  protected getAccountConfig(request: PostRequestDto): ResolvedAccountConfig {
    // Get base config from account or create inline config
    let baseConfig: AccountConfig;
    let source: 'account' | 'inline';

    if (request.account) {
      baseConfig = this.appConfig.getAccount(request.account);
      source = 'account';
    } else if (request.auth) {
      // Create inline config with auth from request
      baseConfig = {
        platform: request.platform.toLowerCase(),
        auth: {},
      };
      source = 'inline';
    } else {
      throw new BadRequestException('Either "account" or "auth" must be provided');
    }

    // Merge auth: request.auth fields override account auth fields
    const mergedAuth = {
      ...baseConfig.auth,
      ...(request.auth || {}),
    };

    return {
      ...baseConfig,
      auth: mergedAuth,
      source,
    };
  }

  /**
   * Validate that platform matches account platform
   * @param platformName - Requested platform
   * @param accountConfig - Account configuration
   * @throws BadRequestException if platform doesn't match
   */
  protected validatePlatformMatch(platformName: string, accountConfig: AccountConfig): void {
    if (String(accountConfig.platform).toLowerCase() !== platformName.toLowerCase()) {
      throw new BadRequestException(
        `Account platform "${accountConfig.platform}" does not match requested platform "${platformName}"`,
      );
    }
  }

  /**
   * Validate auth object for the platform
   * @param platformName - Platform name
   * @param auth - Auth object
   * @throws BadRequestException if auth is invalid
   */
  protected validateAuth(platformName: string, auth: Record<string, any>): void {
    this.authValidatorRegistry.validate(platformName, auth);
  }

  /**
   * Full validation chain for request
   * @param request - Post request
   * @returns Object with platform and accountConfig
   * @throws BadRequestException on validation failure
   */
  protected validateRequest(request: PostRequestDto): {
    platform: IPlatform;
    accountConfig: ResolvedAccountConfig;
  } {
    const platformName = request.platform?.toLowerCase();
    if (!platformName) {
      throw new BadRequestException("Field 'platform' is required");
    }

    const platform = this.getPlatform(platformName);
    const accountConfig = this.getAccountConfig(request);

    this.validatePlatformMatch(platformName, accountConfig);

    this.validateAuth(platformName, accountConfig.auth);

    return { platform, accountConfig };
  }
}
