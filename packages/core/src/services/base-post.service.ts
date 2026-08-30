import type { PostingConfig } from '../config/posting-config.js';
import type { PlatformRegistry } from '../platforms/platform-registry.js';
import type { AuthValidatorRegistry } from '../platforms/auth-validator-registry.js';
import type { IPlatform } from '../platforms/platform.interface.js';
import type { PostRequest } from '../types/post-request.js';
import type { AccountConfig, ResolvedAccountConfig } from '../types/account-config.js';
import type { ILogger } from '../logger/logger.js';
import type { CredentialProvider } from '../auth/credentials.js';
import { ValidationError } from '../errors/posting-error.js';
import { normalizeTarget } from '../types/target.js';
import { isAbsoluteHttpsUrl } from '../config/posting-config.js';
import { sanitizeResumeHandle } from '../types/resume-handle.js';
import type { ResumeHandle } from '../types/resume-handle.js';
import type { PlatformCapabilities } from '../platforms/capabilities.js';

/**
 * Collaborators every posting service needs. Passed explicitly through the
 * constructor — the core has no container and mutates no ambient state.
 */
export interface PostServiceDeps {
  config: PostingConfig;
  platformRegistry: PlatformRegistry;
  authValidatorRegistry: AuthValidatorRegistry;
  logger: ILogger;
  /**
   * Where credentials come from. Defaults to the accounts in the client's own
   * configuration; a host with expiring tokens supplies its own, backed by its
   * encrypted store.
   */
  credentialProvider?: CredentialProvider;
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
  protected readonly credentialProvider?: CredentialProvider;

  constructor(deps: PostServiceDeps) {
    this.config = deps.config;
    this.platformRegistry = deps.platformRegistry;
    this.authValidatorRegistry = deps.authValidatorRegistry;
    this.logger = deps.logger;
    this.credentialProvider = deps.credentialProvider;
  }

  /**
   * Resolve credentials for a request, from a named account or inline auth.
   * @param request - Post request.
   * @throws ValidationError if neither an account nor inline credentials are given.
   */
  protected async getAccountConfig(request: PostRequest): Promise<ResolvedAccountConfig> {
    let baseConfig: AccountConfig;
    let source: 'account' | 'inline';

    if (request.account) {
      baseConfig = this.config.getAccount(request.account);
      source = 'account';

      // A host-supplied provider is the authority on this account's current
      // credentials; the ones in configuration are only a fallback.
      if (this.credentialProvider) {
        const credentials = await this.credentialProvider.getCredentials(request.account);
        baseConfig = { ...baseConfig, auth: { ...baseConfig.auth, ...credentials } };
      }
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
      ...(request.auth ?? {}),
    };

    return {
      ...baseConfig,
      auth: mergedAuth,
      target: normalizeTarget(baseConfig.target),
      source,
    };
  }

  /**
   * The account's API host, checked against what the platform requires.
   *
   * Per-instance networks (Mastodon, Pixelfed, ATProto) have no single host to
   * bake into a package, so the base URL is a property of the account.
   */
  protected validateApiBaseUrl(
    capabilities: PlatformCapabilities,
    accountConfig: ResolvedAccountConfig,
  ): void {
    const { apiBaseUrl } = accountConfig;
    if (apiBaseUrl === undefined) {
      if (capabilities.requiresApiBaseUrl) {
        throw new ValidationError(
          `Platform "${capabilities.name}" is per-instance: the account must carry an apiBaseUrl`,
        );
      }
      return;
    }
    if (!isAbsoluteHttpsUrl(apiBaseUrl)) {
      throw new ValidationError('Account "apiBaseUrl" must be an absolute https URL');
    }
  }

  /**
   * Strip anything a handle must never carry before it reaches the host, or
   * throw in strict mode. A handle is stored by the host; a token inside one
   * is a token in the host's database.
   */
  protected guardResumeHandle(handle: ResumeHandle | undefined): ResumeHandle | undefined {
    if (!handle) {
      return handle;
    }
    return sanitizeResumeHandle(handle, {
      strict: this.config.strictResumeHandles,
      onViolation: violation => {
        this.logger.warn(
          `Resume handle from "${handle.platform}" carried a secret at "${violation.path}"; it was removed. Fix the adapter: a handle must be usable from storage alone.`,
          'ResumeHandle',
        );
      },
    });
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
  protected async validateRequest(request: PostRequest): Promise<{
    platform: IPlatform;
    accountConfig: ResolvedAccountConfig;
  }> {
    const platformName = request.platform.toLowerCase();
    if (!platformName) {
      throw new ValidationError("Field 'platform' is required");
    }

    const platform = this.platformRegistry.get(platformName);
    const accountConfig = await this.getAccountConfig(request);

    this.validatePlatformMatch(platformName, accountConfig);
    this.validateApiBaseUrl(platform.capabilities, accountConfig);
    await this.authValidatorRegistry.validate(platformName, accountConfig.auth, {
      capabilities: platform.capabilities,
      accountRef: request.account,
    });

    return { platform, accountConfig };
  }
}
