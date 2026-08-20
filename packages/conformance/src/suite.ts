import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlatformError, PostType } from '@bozonx/social-posting';
import {
  previewFromCapabilities,
  validateAgainstCapabilities,
  validateCapabilities,
} from '@bozonx/social-posting/platform';
import type { PostRequest, ResumeHandle } from '@bozonx/social-posting';
import type { ContractHarness, PlatformContractOptions } from './types.js';

/**
 * The suite every network must pass before it ships.
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

      it('passes validateCapabilities descriptor checks', () => {
        expect(() => validateCapabilities(platformModule.capabilities)).not.toThrow();
      });

      const authValidator = platformModule.authValidator;
      const authValidatorIt = authValidator ? it : it.skip;
      authValidatorIt('validates its own credential shape when it has a validator', () => {
        expect(authValidator?.providerName.toLowerCase()).toBe(platformModule.name.toLowerCase());
      });
    });

    describe('publishing', () => {
      const declaredTypes = Object.keys(platformModule.capabilities.postTypes ?? {}) as PostType[];

      it('has a sample request for every type it declares', () => {
        const missing = declaredTypes.filter(type => !options.requests[type]);
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
            expect(result.handle).toBeDefined();
            expect(harness.platform.checkStatus).toBeTypeOf('function');
          }
        });
      }

      it('refuses a type it does not declare, without calling the API', async () => {
        const unsupported = Object.values(PostType).find(
          type =>
            type !== PostType.AUTO &&
            !Object.keys(platformModule.capabilities.postTypes ?? {}).includes(type),
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
        const { overLimitRequest } = options;
        harness.respondSuccess();

        await expect(
          harness.platform.publish(overLimitRequest.request, harness.accountConfig),
        ).rejects.toThrow(overLimitRequest.expectedError);
        expect(harness.callCount()).toBe(0);
      });
    });

    if (options.sampleDeleteRef) {
      describe('deletion', () => {
        it('deletes a post by reference', async () => {
          if (harness.platform.delete) {
            harness.respondSuccess();
            const outcome = await harness.platform.delete(
              options.sampleDeleteRef!,
              harness.accountConfig,
            );
            expect(['deleted', 'partial']).toContain(outcome.status);
            expect(outcome.parts.length).toBeGreaterThan(0);
          }
        });
      });
    }

    describe('error contract', () => {
      for (const errorCase of options.errorCases) {
        it(`maps ${errorCase.name} to ${errorCase.expect.code}`, async () => {
          harness.respondWith(errorCase.response);

          const error = (await harness.platform
            .publish(firstRequest(options), harness.accountConfig)
            .catch((thrown: unknown) => thrown)) as PlatformError;

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

      it('stops a publication aborted mid-flight when the harness supports it', async () => {
        if (!harness.respondNever) return;
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
        if (result.success) {
          expect(result.data.valid).toBe(true);
        }
        expect(harness.callCount()).toBe(0);
      });

      it('agrees with publish about what is valid', async () => {
        const request = firstRequest(options);

        const validation = validateAgainstCapabilities(
          request,
          harness.platform.capabilities,
          hooks(harness),
        );

        expect(validation.issues).toEqual([]);
      });
    });

    describe('resumable publication', () => {
      const resumable = options.resumable;
      const resumableIt = resumable ? it : it.skip;
      resumableIt('continues from a resume handle instead of starting over', async () => {
        const scenario = resumable ?? missingScenario();

        scenario.arrangeInterruption(harness);
        const failure = (await harness.platform
          .publish(scenario.request, harness.accountConfig)
          .catch((thrown: unknown) => thrown)) as PlatformError;

        expect(failure).toBeInstanceOf(PlatformError);
        expect(failure.resumeHandle).toBeDefined();
        expect(failure.resumeHandle?.platform).toBe(platformModule.name);
        expect(JSON.parse(JSON.stringify(failure.resumeHandle))).toEqual(failure.resumeHandle);

        const handle = failure.resumeHandle as ResumeHandle;
        const callsBeforeResume = harness.callCount();
        scenario.arrangeResume(harness, handle);

        const result = await harness.platform.publish(scenario.request, harness.accountConfig, {
          resume: handle,
        });

        expect(['published', 'processing']).toContain(result.status);
        expect(harness.callCount() - callsBeforeResume).toBeLessThanOrEqual(
          scenario.completedStepsBeforeInterruption,
        );
      });
    });
  });
}

function missingScenario(): never {
  throw new Error('Resumable contract test ran without a resumable scenario');
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
  const validateExtra = harness.platform.validateExtra?.bind(harness.platform);
  return {
    detectType: harness.platform.detectType?.bind(harness.platform),
    validateExtra: validateExtra
      ? (request: PostRequest, type: PostType) =>
          validateExtra(request, harness.accountConfig, type)
      : undefined,
  };
}
