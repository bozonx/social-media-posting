import type {
  ErrorCode,
  IPlatform,
  PlatformModule,
  PostRequest,
  PostType,
  ResolvedAccountConfig,
  ResumeHandle,
} from '@bozonx/social-posting';

/**
 * A response recorded from a real platform API.
 *
 * Kept as status, headers and body rather than as a parsed object, because the
 * paths that break in production — a 429 whose cool-down lives in a header, a
 * moderation refusal whose reason lives in the body — are exactly the ones a
 * tidied-up fixture loses.
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
 *
 * Only the platform knows its own endpoints, so the suite asks it to install
 * and remove the double rather than guessing at URLs.
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
  /**
   * Arrange the transport so the publication fails after some progress.
   * @returns The harness to run the failing attempt against.
   */
  arrangeInterruption(harness: ContractHarness): void;
  /**
   * Arrange the transport so a resumed publication succeeds, and report how
   * many calls the *first* steps would have taken. The suite asserts the
   * resumed attempt does not repeat them.
   */
  arrangeResume(harness: ContractHarness, handle: ResumeHandle): void;
}

/** Everything the contract suite needs to exercise one platform. */
export interface PlatformContractOptions {
  /** The descriptor the platform package exports. */
  module: PlatformModule;
  /** Build a fresh harness; called once per test. */
  createHarness(): ContractHarness;
  /**
   * A valid request per post type the platform declares.
   *
   * A declared type without a request here fails the suite: a type a platform
   * claims to support and cannot demonstrate is a claim, not a capability.
   */
  requests: Partial<Record<PostType, PostRequest>>;
  /** Recorded failures and the classification each must produce. */
  errorCases: ErrorCase[];
  /** A request that breaks a declared limit, and the message it must produce. */
  overLimitRequest?: { request: PostRequest; expectedError: RegExp };
  /** A multi-step publication, for platforms that have one. */
  resumable?: ResumableScenario;
}
