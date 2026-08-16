import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PlatformError,
  PostType,
  previewFromCapabilities,
  validateAgainstCapabilities,
} from '@bozonx/social-posting';
import type { PostRequest, ResumeHandle } from '@bozonx/social-posting';
import type { ContractHarness, PlatformContractOptions } from './types.js';

/**
 * The suite every network must pass before it ships.
 *
 * Adding a network is meant to be "implement the interface and run this". That
 * only holds if the suite checks the things that actually break in production:
 * the declared capabilities being real, failures classified so a host can act
 * on them, cancellation honoured, no global state touched, and an interrupted
 * multi-step publication resuming rather than duplicating.
 *
 * @param options - The platform, a transport harness, and its fixtures.
 */
export function describePlatformContract(options: PlatformContractOptions): void {
  const { module: platformModule } = options;

  describe(`platform contract: ${platformModule.name}`, () => {
    let harness: ContractHarness;

    beforeEach(() => {
      harness = options.createHarness();
    });

    afterEach(() => {
      harness.restore();
      vi.restoreAllMocks();
    });

    describe('descriptor', () => {
      it('agrees with the platform instance about its own name', () => {
        expect(harness.platform.name).toBe(platformModule.name);
        expect(harness.platform.capabilities.name).toBe(platformModule.name);
        expect(platformModule.capabilities.name).toBe(platformModule.name);
      });

      it('declares at least one publishable type', () => {
        const publishable = platformModule.capabilities.supportedTypes.filter(
          type => type !== PostType.AUTO,
        );

        expect(publishable.length).toBeGreaterThan(0);
      });

      it('describes only types it claims to support', () => {
        const described = Object.keys(platformModule.capabilities.postTypes ?? {});

        for (const type of described) {
          expect(platformModule.capabilities.supportedTypes).toContain(type as PostType);
        }
      });

      it('states how media reaches it', () => {
        const { supportsUrlPassthrough, requiresByteUpload } = platformModule.capabilities;

        // These two decide whether the network is viable on a memory-limited
        // runtime, so leaving them unstated is not an option.
        expect(supportsUrlPassthrough === undefined && requiresByteUpload === undefined).toBe(
          false,
        );
      });

      it('validates its own credential shape when it has a validator', () => {
        if (!platformModule.authValidator) {
          return;
        }
        expect(platformModule.authValidator.providerName.toLowerCase()).toBe(
          platformModule.name.toLowerCase(),
        );
      });
    });

    describe('publishing', () => {
      const declaredTypes = platformModule.capabilities.supportedTypes.filter(
        type => type !== PostType.AUTO,
      );

      it('has a sample request for every type it declares', () => {
        const missing = declaredTypes.filter(type => !options.requests[type]);

        // A type a platform claims and cannot demonstrate is a claim, not a
        // capability.
        expect(missing).toEqual([]);
      });

      for (const type of declaredTypes) {
        it(`round-trips a '${type}' post`, async () => {
          const request = options.requests[type];
          if (!request) {
            return;
          }

          harness.respondSuccess();
          const result = await harness.platform.publish(request, harness.accountConfig);

          expect(['published', 'processing']).toContain(result.status);
          if (result.status === 'published') {
            expect(result.postId).toBeTruthy();
          } else {
            // A deferred result is only useful if the host can follow it up.
            expect(result.handle).toBeDefined();
            expect(harness.platform.checkStatus).toBeTypeOf('function');
          }
        });
      }

      it('refuses a type it does not declare, without calling the API', async () => {
        const unsupported = Object.values(PostType).find(
          type => !platformModule.capabilities.supportedTypes.includes(type),
        );
        if (!unsupported) {
          return;
        }

        const sample = firstRequest(options);
        harness.respondSuccess();

        await expect(
          harness.platform.publish({ ...sample, type: unsupported }, harness.accountConfig),
        ).rejects.toThrow();
        expect(harness.callCount()).toBe(0);
      });

      it('enforces a declared limit locally rather than through the API', async () => {
        if (!options.overLimitRequest) {
          return;
        }

        harness.respondSuccess();

        await expect(
          harness.platform.publish(options.overLimitRequest.request, harness.accountConfig),
        ).rejects.toThrow(options.overLimitRequest.expectedError);
        expect(harness.callCount()).toBe(0);
      });
    });

    describe('error contract', () => {
      for (const errorCase of options.errorCases) {
        it(`maps ${errorCase.name} to ${errorCase.expect.code}`, async () => {
          harness.respondWith(errorCase.response);

          const error = (await harness.platform
            .publish(firstRequest(options), harness.accountConfig)
            .catch((thrown: unknown) => thrown)) as PlatformError;

          // Everything a host needs to schedule its own retry has to be on the
          // error, or the host has nothing to key on.
          expect(error).toBeInstanceOf(PlatformError);
          expect(error.code).toBe(errorCase.expect.code);
          expect(error.retryable).toBe(errorCase.expect.retryable);

          if (errorCase.expect.retryAfterMs !== undefined) {
            expect(error.retryAfterMs).toBe(errorCase.expect.retryAfterMs);
          }
          if (errorCase.expect.httpStatus !== undefined) {
            expect(error.httpStatus).toBe(errorCase.expect.httpStatus);
          }
        });
      }
    });

    describe('cancellation', () => {
      it('does not call the API when the signal is already aborted', async () => {
        const controller = new AbortController();
        controller.abort();
        harness.respondSuccess();

        await harness.platform
          .publish(firstRequest(options), harness.accountConfig, { signal: controller.signal })
          .catch(() => undefined);

        expect(harness.callCount()).toBe(0);
      });

      it('stops a publication aborted mid-flight', async () => {
        if (!harness.respondNever) {
          return;
        }

        harness.respondNever();
        const controller = new AbortController();

        const inFlight = harness.platform.publish(firstRequest(options), harness.accountConfig, {
          signal: controller.signal,
        });
        controller.abort();

        await expect(inFlight).rejects.toThrow();
      });
    });

    describe('isolation', () => {
      it('mutates no global state while publishing', async () => {
        // Identity of `console.log` is not comparable across runtimes — workerd
        // hands back a fresh bound function on every access — so this checks
        // the properties that are stable everywhere. Whether the platform
        // hijacks logging is covered by the next test.
        const beforeNow = Date.now;
        const beforeKeys = Object.keys(globalThis).sort();
        harness.respondSuccess();

        await harness.platform.publish(firstRequest(options), harness.accountConfig);

        expect(Date.now).toBe(beforeNow);
        expect(Object.keys(globalThis).sort()).toEqual(beforeKeys);
      });

      it('writes to the injected logger, not to the host console', async () => {
        const spies = [
          vi.spyOn(console, 'log').mockImplementation(() => {}),
          vi.spyOn(console, 'warn').mockImplementation(() => {}),
          vi.spyOn(console, 'error').mockImplementation(() => {}),
        ];
        harness.respondSuccess();

        await harness.platform.publish(firstRequest(options), harness.accountConfig);

        for (const spy of spies) {
          expect(spy).not.toHaveBeenCalled();
        }
      });
    });

    describe('preview', () => {
      it('validates without publishing', async () => {
        harness.respondSuccess();
        const request = firstRequest(options);

        const result = harness.platform.preview
          ? await harness.platform.preview(request, harness.accountConfig)
          : previewFromCapabilities(request, harness.platform.capabilities, hooks(harness));

        expect(result.success).toBe(true);
        expect(harness.callCount()).toBe(0);
      });

      it('agrees with publish about what is valid', async () => {
        const request = firstRequest(options);

        const validation = validateAgainstCapabilities(
          request,
          harness.platform.capabilities,
          hooks(harness),
        );

        expect(validation.errors).toEqual([]);
      });
    });

    describe('resumable publication', () => {
      it('continues from a resume handle instead of starting over', async () => {
        const scenario = options.resumable;
        if (!scenario) {
          return;
        }

        scenario.arrangeInterruption(harness);
        const failure = (await harness.platform
          .publish(scenario.request, harness.accountConfig)
          .catch((thrown: unknown) => thrown)) as PlatformError;

        expect(failure).toBeInstanceOf(PlatformError);
        expect(failure.resumeHandle).toBeDefined();
        expect(failure.resumeHandle?.platform).toBe(platformModule.name);
        // The host stores this in a JSON job record.
        expect(JSON.parse(JSON.stringify(failure.resumeHandle))).toEqual(failure.resumeHandle);

        const handle = failure.resumeHandle as ResumeHandle;
        const callsBeforeResume = harness.callCount();
        scenario.arrangeResume(harness, handle);

        const result = await harness.platform.publish(scenario.request, harness.accountConfig, {
          resume: handle,
        });

        expect(['published', 'processing']).toContain(result.status);
        // Resuming must not redo the steps the first attempt completed: that is
        // what would create a second uploaded file or a second post.
        expect(harness.callCount() - callsBeforeResume).toBeLessThan(callsBeforeResume);
      });
    });
  });
}

/** Any valid request, for tests that only need "a publishable post". */
function firstRequest(options: PlatformContractOptions): PostRequest {
  const request = Object.values(options.requests)[0];
  if (!request) {
    throw new Error('The contract suite needs at least one sample request');
  }
  return request;
}

/** The platform's own validation hooks, when it has them. */
function hooks(harness: ContractHarness) {
  return {
    detectType: harness.platform.detectType?.bind(harness.platform),
    validateExtra: harness.platform.validateExtra
      ? (request: PostRequest, type: PostType) =>
          harness.platform.validateExtra!(request, harness.accountConfig, type)
      : undefined,
  };
}
