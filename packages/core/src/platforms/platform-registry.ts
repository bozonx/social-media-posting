import type { IPlatform } from './platform.interface.js';
import { ValidationError } from '../errors/posting-error.js';

/**
 * Registry of platform implementations, keyed by lower-cased platform name.
 */
export class PlatformRegistry {
  private readonly platforms = new Map<string, IPlatform>();

  /**
   * Register a platform instance, replacing any platform of the same name.
   * @param platform - Platform instance to register.
   */
  register(platform: IPlatform): void {
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
}
