import type {
  ErrorCode,
  PlatformModule,
  PostRequest,
  PostType,
  PostRef,
  ResolvedAccountConfig,
  ResumeHandle,
} from '@bozonx/social-posting';
import type { IPlatform } from '@bozonx/social-posting/platform';

/**
 * A response recorded from a real platform API.
 */
export interface RecordedResponse {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

/** One recorded failure and the classification it must produce. */
export interface ErrorCase {
  /** What this failure is, for the test name. */
  name: string;
  /** The response the platform API returned. */
  response: RecordedResponse;
  /** What the library must turn it into. */
  expect: {
    code: ErrorCode;
    retryable: boolean;
    retryAfterMs?: number;
    httpStatus?: number;
  };
}

/**
 * The transport double a platform package supplies.
 */
export interface ContractHarness {
  /** A platform instance wired to this harness. */
  platform: IPlatform;
  /** Credentials and per-account settings the platform accepts. */
  accountConfig: ResolvedAccountConfig;
  /** Answer every subsequent call as a success. */
  respondSuccess(): void;
  /** Answer every subsequent call with a recorded response. */
  respondWith(response: RecordedResponse): void;
  /** Never answer, so a test can abort mid-flight. */
  respondNever?(): void;
  /** How many calls the transport has seen. */
  callCount(): number;
  /** Put the real transport back. */
  restore(): void;
}

/** A multi-step publication that fails part way and is then resumed. */
export interface ResumableScenario {
  /** A request whose publication takes more than one call. */
  request: PostRequest;
  /** Number of completed transport steps that a resumed attempt must not repeat. */
  completedStepsBeforeInterruption: number;
  /** Arrange the transport so the publication fails after some progress. */
  arrangeInterruption(harness: ContractHarness): void;
  /** Arrange the transport so a resumed publication succeeds. */
  arrangeResume(harness: ContractHarness, handle: ResumeHandle): void;
}

/**
 * A publication whose outcome the platform never confirmed: a timed-out or
 * bodyless-5xx `create`. What must not happen is a second post.
 */
export interface UnknownOutcomeScenario {
  /** A request that reaches the create step. */
  request: PostRequest;
  /** Arrange the transport so the create step answers ambiguously. */
  arrangeAmbiguousCreate(harness: ContractHarness): void;
}

/** Everything the contract suite needs to exercise one platform. */
export interface PlatformContractOptions {
  /** The descriptor the platform package exports. */
  module: PlatformModule;
  /** Build a fresh harness; called once per test. */
  createHarness(): ContractHarness;
  /** A valid request per post type the platform declares. */
  requests: Partial<Record<PostType, PostRequest>>;
  /** Recorded failures and the classification each must produce. */
  errorCases: ErrorCase[];
  /** A request that breaks a declared limit, and the message it must produce. */
  overLimitRequest: { request: PostRequest; expectedError: RegExp };
  /** Sample PostRef for deletion tests, if deletion is supported. */
  sampleDeleteRef?: PostRef;
  /** A multi-step publication, for platforms that have one. */
  resumable?: ResumableScenario;
  /** An ambiguous `create`, for platforms whose publication is not atomic. */
  unknownOutcome?: UnknownOutcomeScenario;
}
