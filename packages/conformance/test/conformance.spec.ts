import { ErrorCode, PlatformError, PostType, ValidationError } from '@bozonx/social-posting';
import type {
  PlatformCapabilities,
  PlatformModule,
  PostRequest,
  ResolvedAccountConfig,
  ResumeHandle,
} from '@bozonx/social-posting';
import { validateAgainstCapabilities } from '@bozonx/social-posting/platform';
import type {
  IAuthValidator,
  IPlatform,
  PlatformPublishResponse,
} from '@bozonx/social-posting/platform';

import { describePlatformContract } from '../src/suite.js';
import type {
  ContractHarness,
  ErrorCase,
  PlatformContractOptions,
  RecordedResponse,
} from '../src/types.js';

class MockPlatform implements IPlatform {
  readonly name = 'mock-network';
  readonly capabilities: PlatformCapabilities = {
    name: 'mock-network',
    postTypes: {
      [PostType.POST]: {
        requiredFields: ['body'],
        forbiddenFields: ['media'],
      },
      [PostType.IMAGE]: {
        requiredFields: ['media'],
      },
    },
    maxBodyLength: 50,
  };

  private calls = 0;
  private nextResponse?: RecordedResponse;
  private neverResolve = false;

  setNextResponse(res?: RecordedResponse): void {
    this.nextResponse = res;
  }

  setNeverResolve(): void {
    this.neverResolve = true;
  }

  getCallCount(): number {
    return this.calls;
  }

  async publish(
    request: PostRequest,
    _account: ResolvedAccountConfig,
    options?: { signal?: AbortSignal; resume?: ResumeHandle },
  ): Promise<PlatformPublishResponse> {
    if (options?.signal?.aborted) {
      throw new PlatformError('Aborted', ErrorCode.NETWORK_ERROR, { retryable: false });
    }

    if (this.neverResolve) {
      return new Promise((_, reject) => {
        options?.signal?.addEventListener('abort', () => {
          reject(new PlatformError('Aborted in-flight', ErrorCode.NETWORK_ERROR));
        });
      });
    }

    const validation = validateAgainstCapabilities(request, this.capabilities);
    if (validation.issues.length > 0) {
      throw new ValidationError(validation.issues);
    }

    this.calls += 1;

    if (this.nextResponse) {
      const resp = this.nextResponse;
      this.nextResponse = undefined;
      if (resp.status === 429) {
        throw new PlatformError('Rate limited', ErrorCode.RATE_LIMIT_ERROR, {
          retryable: true,
          httpStatus: 429,
          retryAfterMs: 3000,
        });
      }
      if (resp.status === 500) {
        throw new PlatformError('API Error', ErrorCode.NETWORK_ERROR, {
          retryable: true,
          httpStatus: 500,
          resumeHandle: { platform: 'mock-network', step: 'upload', state: { offset: 100 } },
        });
      }
      if (resp.status >= 400) {
        throw new PlatformError('API Error', ErrorCode.NETWORK_ERROR, {
          retryable: true,
          httpStatus: resp.status,
        });
      }
    }

    if (options?.resume) {
      return { status: 'published', postId: 'resumed-post-1' };
    }

    return { status: 'published', postId: 'mock-post-123' };
  }
}

const mockAuthValidator: IAuthValidator = {
  providerName: 'mock-network',
  validate: () => ({ errors: [] }),
};

const mockModule: PlatformModule = {
  name: 'mock-network',
  capabilities: {
    name: 'mock-network',
    postTypes: {
      [PostType.POST]: {
        requiredFields: ['body'],
        forbiddenFields: ['media'],
      },
      [PostType.IMAGE]: {
        requiredFields: ['media'],
      },
    },
    maxBodyLength: 50,
  },
  authValidator: mockAuthValidator,
  create: () => new MockPlatform(),
};

function createMockHarness(): ContractHarness {
  const platform = new MockPlatform();
  const accountConfig: ResolvedAccountConfig = {
    platform: 'mock-network',
    auth: { apiKey: 'secret' },
    source: 'account',
  };

  return {
    platform,
    accountConfig,
    respondSuccess() {
      platform.setNextResponse({ status: 200, body: { ok: true } });
    },
    respondWith(response: RecordedResponse) {
      platform.setNextResponse(response);
    },
    respondNever() {
      platform.setNeverResolve();
    },
    callCount() {
      return platform.getCallCount();
    },
    restore() {},
  };
}

const errorCases: ErrorCase[] = [
  {
    name: 'rate limit 429',
    response: { status: 429, body: { error: 'Too Many Requests' } },
    expect: {
      code: ErrorCode.RATE_LIMIT_ERROR,
      retryable: true,
      retryAfterMs: 3000,
      httpStatus: 429,
    },
  },
];

const contractOptions: PlatformContractOptions = {
  module: mockModule,
  createHarness: createMockHarness,
  requests: {
    [PostType.POST]: { platform: 'mock-network', body: 'Hello post', type: PostType.POST },
    [PostType.IMAGE]: {
      platform: 'mock-network',
      media: [{ source: { kind: 'url', url: 'https://a.com/b.jpg' } }],
      type: PostType.IMAGE,
    },
  },
  errorCases,
  overLimitRequest: {
    request: { platform: 'mock-network', body: 'a'.repeat(60), type: PostType.POST },
    expectedError: /exceeds the 50 characters/,
  },
  resumable: {
    request: { platform: 'mock-network', body: 'Resumable post', type: PostType.POST },
    completedStepsBeforeInterruption: 1,
    arrangeInterruption(harness) {
      harness.respondWith({ status: 500, body: {} });
    },
    arrangeResume(harness) {
      harness.respondSuccess();
    },
  },
};

// Exercise the conformance suite itself
describePlatformContract(contractOptions);
