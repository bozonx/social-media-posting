import type { PostingConfig } from '../config/posting-config.js';
import type { PlatformRegistry } from '../platforms/platform-registry.js';
import type { AuthValidatorRegistry } from '../platforms/auth-validator-registry.js';
import type { IPlatform } from '../platforms/platform.interface.js';
import type { PostRequest } from '../types/post-request.js';
import type { AccountConfig, ResolvedAccountConfig } from '../types/account-config.js';
import type { ILogger } from '../logger/logger.js';
import { ValidationError } from '../errors/posting-error.js';

/**
 * Collaborators every posting service needs. Passed explicitly through the
 * constructor — the core has no container and mutates no ambient state.
 */
export interface PostServiceDeps {
  config: PostingConfig;
  platformRegistry: PlatformRegistry;
  authValidatorRegistry: AuthValidatorRegistry;
  logger: ILogger;
}

/**
 * Shared request resolution for publishing and previewing: which platform
 * handles the request, which credentials it runs with, and whether those
 * credentials are well-formed.
 */
export abstract class BasePostService {
  protected readonly config: PostingConfig;
  protected readonly platformRegistry: PlatformRegistry;
  protected readonly authValidatorRegistry: AuthValidatorRegistry;
  protected readonly logger: ILogger;

  constructor(deps: PostServiceDeps) {
    this.config = deps.config;
    this.platformRegistry = deps.platformRegistry;
    this.authValidatorRegistry = deps.authValidatorRegistry;
    this.logger = deps.logger;
  }

  /**
   * Resolve credentials for a request, from a named account or inline auth.
   * @param request - Post request.
   * @throws ValidationError if neither an account nor inline credentials are given.
   */
  protected getAccountConfig(request: PostRequest): ResolvedAccountConfig {
    let baseConfig: AccountConfig;
    let source: 'account' | 'inline';

    if (request.account) {
      baseConfig = this.config.getAccount(request.account);
      source = 'account';
    } else if (request.auth) {
      baseConfig = {
        platform: request.platform.toLowerCase(),
        auth: {},
      };
      source = 'inline';
    } else {
      throw new ValidationError('Either "account" or "auth" must be provided');
    }

    // Request-level credentials win over the ones stored with the account.
    const mergedAuth = {
      ...baseConfig.auth,
      ...((request.auth ?? {}) as Record<string, string>),
    };

    return {
      ...baseConfig,
      auth: mergedAuth,
      source,
    };
  }

  /**
   * Reject a request that targets one platform with another platform's account.
   * @param platformName - Requested platform.
   * @param accountConfig - Resolved account configuration.
   * @throws ValidationError on a mismatch.
   */
  protected validatePlatformMatch(platformName: string, accountConfig: AccountConfig): void {
    if (String(accountConfig.platform).toLowerCase() !== platformName.toLowerCase()) {
      throw new ValidationError(
        `Account platform "${accountConfig.platform}" does not match requested platform "${platformName}"`,
      );
    }
  }

  /**
   * Resolve and validate everything a platform call needs.
   * @param request - Post request.
   * @throws ValidationError on any resolution or validation failure.
   */
  protected validateRequest(request: PostRequest): {
    platform: IPlatform;
    accountConfig: ResolvedAccountConfig;
  } {
    const platformName = request.platform?.toLowerCase();
    if (!platformName) {
      throw new ValidationError("Field 'platform' is required");
    }

    const platform = this.platformRegistry.get(platformName);
    const accountConfig = this.getAccountConfig(request);

    this.validatePlatformMatch(platformName, accountConfig);
    this.authValidatorRegistry.validate(platformName, accountConfig.auth);

    return { platform, accountConfig };
  }
}
