import type { IPlatform } from './platform.interface.js';
import type { PlatformCapabilities } from './capabilities.js';
import { validateCapabilities } from './capabilities.js';
import { ValidationError } from '../errors/posting-error.js';

/**
 * Registry of platform implementations, keyed by lower-cased platform name.
 */
export class PlatformRegistry {
  private readonly platforms = new Map<string, IPlatform>();

  /**
   * Register a platform instance, replacing any platform of the same name.
   * Validates the platform capabilities descriptor on registration.
   * @param platform - Platform instance to register.
   */
  register(platform: IPlatform): void {
    validateCapabilities(platform.capabilities);
    this.platforms.set(platform.name.toLowerCase(), platform);
  }

  /**
   * Get a platform by name.
   * @param platformName - Platform name (e.g. 'telegram').
   * @throws ValidationError if the platform is not registered.
   */
  get(platformName: string): IPlatform {
    const platform = this.platforms.get(platformName.toLowerCase());
    if (!platform) {
      throw new ValidationError(`Platform "${platformName}" is not supported`);
    }
    return platform;
  }

  /**
   * Check whether a platform is registered.
   * @param platformName - Platform name.
   */
  has(platformName: string): boolean {
    return this.platforms.has(platformName.toLowerCase());
  }

  /**
   * List the names of all registered platforms.
   */
  getRegisteredPlatforms(): string[] {
    return Array.from(this.platforms.keys());
  }

  /**
   * Read what a platform accepts, so a host UI can render its limits without
   * attempting a publish.
   * @param platformName - Platform name.
   * @throws ValidationError if the platform is not registered.
   */
  getCapabilities(platformName: string): PlatformCapabilities {
    return this.get(platformName).capabilities;
  }
}
