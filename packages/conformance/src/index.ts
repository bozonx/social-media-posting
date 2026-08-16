/**
 * `@bozonx/social-posting-conformance` — the contract suite a network must pass.
 *
 * Adding a social network is meant to be "implement `IPlatform`, describe the
 * network in a `PlatformCapabilities`, and run this". Publish a package that
 * passes it and the network is done.
 */
export { describePlatformContract } from './suite.js';
export type {
  PlatformContractOptions,
  ContractHarness,
  RecordedResponse,
  ErrorCase,
  ResumableScenario,
} from './types.js';
