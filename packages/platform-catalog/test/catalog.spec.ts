import { describe, expect, it } from 'vitest';
import { validateCapabilities } from '@bozonx/social-posting/platform';
import { platformProfiles } from '../src/index.js';

describe('platform capability catalog', () => {
  it('contains a valid descriptor or an explicit unavailable status for every profile', () => {
    for (const profile of Object.values(platformProfiles)) {
      if (profile.capabilities) validateCapabilities(profile.capabilities);
      else expect(profile.apiAvailability).toBe('unavailable');
    }
  });

  it('records official source provenance for every capability descriptor', () => {
    for (const profile of Object.values(platformProfiles)) {
      if (!profile.capabilities) continue;
      expect(profile.capabilities.sources?.length).toBeGreaterThan(0);
      expect(profile.capabilities.sources?.every(source => source.url.startsWith('https://'))).toBe(
        true,
      );
    }
  });
});
