# @bozonx/social-posting-conformance

The contract suite every `@bozonx/social-posting` platform must pass.

Adding a social network is meant to be "implement `IPlatform`, describe the network in a
`PlatformCapabilities`, and run this". Publish a package that passes the suite and the network is
done — including networks maintained outside this repository.

```ts
import { describePlatformContract } from '@bozonx/social-posting-conformance';
import { mastodon } from '../src/index.js';

describePlatformContract({
  module: mastodon,
  createHarness,          // installs a transport double; only you know your endpoints
  requests: { post: … },  // one valid request per declared post type
  errorCases: [ … ],      // recorded failures and the classification each must produce
  resumable: { … },       // for networks whose publication takes several calls
});
```

## What it checks

- Every post type the descriptor declares round-trips.
- Declared limits are enforced locally, without a wasted API call.
- Each recorded failure maps to the right `ErrorCode` with the right `retryable`, `retryAfterMs`
  and `httpStatus` — the fields a host's backoff actually reads.
- An already-aborted signal makes no API call; an abort mid-flight stops the publication.
- Publishing mutates no global state and writes to no ambient logger.
- Preview agrees with publish about what is valid.
- An interrupted multi-step publication resumes from its `ResumeHandle` rather than restarting —
  which is what would otherwise upload a second file and create a second post.

See `CONTRIBUTING-PLATFORMS.md` in the repository for the full walkthrough.
