# Adding a social network

Adding a network is meant to be a bounded, repeatable job: describe the network as data,
implement one interface, record real API responses, and pass a suite that already exists. If you
find yourself writing validation logic, preview logic or retry logic, stop — that work is already
done in `@bozonx/social-posting`, and duplicating it is how networks drift apart.

## Start

```bash
pnpm platform mastodon    # scaffolds packages/platform-mastodon
pnpm install
```

You get a manifest, a capability descriptor, a platform skeleton, a credential validator, and a
spec already wired to the contract suite. It compiles and the suite passes before you have written
anything — so from the first change you are watching a green suite go red for a reason.

## What you actually write

```
packages/platform-<network>/
  src/capabilities.ts        # data: types, limits, formats, quotas, transport traits
  src/<network>.platform.ts  # publish() (+ checkStatus(), + resume, if multi-step), error mapping
  src/<network>-auth.validator.ts
  src/index.ts               # the PlatformModule descriptor
  test/fixtures/…            # recorded API responses: successes and refusals
  test/contract.spec.ts      # the contract suite plus anything network-specific
```

Plus a row in the README support table and a row in `docs/DELIVERY-SEMANTICS.md`.

### 1. The capability descriptor is the important file

Everything the library does generically reads this: which post types exist, what each requires or
refuses, how long a body may be and how the network counts it, which media it accepts, whether it
fetches media itself. Fill each field from the network's own documentation.

Where the network documents no limit, **leave the field out** rather than guessing. An invented
limit rejects posts the network would have accepted, and nobody will ever suspect the descriptor.

Declare supported media types, accepted sources, and — required — who moves the bytes:

```ts
media: {
  image: {
    acceptedSources: ['url'],
    transport: 'pull',                  // the network fetches the URL itself
    requiresPubliclyFetchableUrl: true,
    urlMustRemainAvailableForSecs: 3600,
  },
  video: {
    acceptedSources: ['bytes', 'blob', 'stream'],
    transport: 'push',                  // we upload the bytes
    containers: ['mp4', 'mov'],
    videoCodecs: ['h264'],
    maxFrameRate: 60,
  },
}
```

`transport` is not optional. Without it the library cannot refuse a bare URL to a network that
only accepts uploads — or bytes to one that only fetches — before the first HTTP call, and
refusing before the call is the entire point of the descriptor. Codec, container and frame-rate
values are declarations for the host and for `preview()`: the core never opens a file, so it
checks them only when the `MediaInput` states them.

### Post types, and naming them

`capabilities.postTypes` may only use a canonical name from `PostType` — `post`, `article`,
`image`, `album`, `video`, `shortVideo`, `audio`, `document`, `story`, `thread`, `event`, `live`,
`poll` — or a namespaced extension of your own, `x-<network>-<name>`. Anything else fails at
module registration, not at publish time. That rule exists so fifteen networks do not end up with
`shortVideo`, `short_video` and `reel` meaning the same thing.

`shortVideo` and `story` are never inferred from media: a caller asks for them explicitly.

### Addressing: `target` and `apiBaseUrl`

An adapter never sees a scalar `target`. The core normalizes it to `{ id }` first, and any further
parts of a composite address (a board's section, a forum topic) are declared in
`capabilities.targetSchema` and validated exactly like `extra`:

```ts
targetSchema: [{ name: 'sectionId', type: 'string', maxLength: 40 }],
```

If your network is per-instance — Mastodon, Pixelfed, ATProto — set `requiresApiBaseUrl: true` and
read the host from `accountConfig.apiBaseUrl`. Never bake a base URL into the package.

### 2. `publish()` translates, and classifies

Two responsibilities, and only these:

- Turn the request into API calls, using `httpRequest()` so a connection that dies before the
  request completes is retried once — and nothing else is ever retried.
- Turn a failure into a `PlatformError` with the right `code`, an honest `retryable`, and
  `retryAfterMs` whenever the network states a cool-down.

The error mapping is the part hosts actually depend on. Without it they cannot back off correctly,
which is the whole reason they delegated retrying to themselves in the first place.

```ts
throw new PlatformError('Too Many Requests', ErrorCode.RATE_LIMIT_ERROR, {
  retryable: true,
  retryAfterMs: retryAfterSeconds * 1000,
  httpStatus: 429,
});
```

Use `AUTH_REFRESH_REQUIRED` when only re-authorization can help, `CONTENT_REJECTED` when
moderation refused the content, and `QUOTA_EXCEEDED` when a per-period allowance is spent. A host
treats these very differently, and getting them wrong fills a queue with jobs that can never drain.

### 3. Multi-step publications must resume

If publishing takes more than one call — upload then publish, INIT/APPEND/FINALIZE, register then
PUT then create — a failure part way **must** carry a `ResumeHandle`:

```ts
throw new PlatformError('upload interrupted', ErrorCode.NETWORK_ERROR, {
  retryable: true,
  resumeHandle: { platform: 'x', step: 'upload', state: { mediaId, offsetBytes } },
});
```

and `publish(request, { resume })` must continue from it. Without this, a host's retry starts from
step one and creates a second uploaded file and a second post. `runChunkedUpload()` does this for
you if your API has the usual chunked shape.

The handle must survive `JSON.stringify` — the host stores it in a job record — and it must carry
**no secrets**: no access token, no signed upload URL, no authorization header. The core scans
every handle on its way out; in `strictResumeHandles` mode (development and tests) a leak throws,
and in production the field is stripped and a warning logged. Derive credentials from the account
on resume instead.

`buildMultipartFormData()`, `runSinglePartUpload()` and `runUploadSequence()` cover the
non-chunked shapes, the last one recording which of `init → upload → finalize → status` was
reached.

### 3b. A `create` whose outcome you do not know

A create step that timed out, or answered 5xx with no body, may well have published. Never repeat
it. Mark the failure and let the core decide:

```ts
throw new PlatformError('create timed out', ErrorCode.TIMEOUT_ERROR, {
  retryable: true,
  outcomeUnknown: true,
  resumeHandle: { platform: 'x', step: 'create', state: { attemptId } },
});
```

Then give the network one of the two ways out:

- implement `reconcile(handle, accountConfig)` so the library can ask whether the post exists;
- or declare `supportsIdempotencyKey: true` and send the request's `idempotencyKey`.

With neither, the host gets `UNKNOWN_OUTCOME` — an outcome it must show as "check the account",
never a second publish.

### 4. Don't implement `preview()`

It is optional, and the default reads your descriptor and your `validateExtra()` hook — the same
checks `publish()` runs. Implement it only if the network offers a real dry-run. A hand-written
preview is the same rules written twice, and the copies diverge.

### 5. Fixtures: record the refusals

```
test/fixtures/errors.json     # 429 with its cool-down, 401, a moderation refusal, a 5xx
test/fixtures/success.json
```

Record what the API really returned, not a tidied-up version. The failure paths are the ones that
break in production, and a fixture that has been cleaned up is a fixture that no longer tests
anything.

## The gate

```bash
pnpm validate             # check + unit tests
pnpm validate:all         # full verification before opening a PR
```

The contract suite checks the things that actually go wrong:

- every declared post type round-trips;
- declared limits are enforced locally, without a wasted API call;
- each recorded failure maps to the right code with the right `retryable`;
- an already-aborted signal makes no API call, and an abort mid-flight stops the publication;
- publishing mutates no global state and writes to no ambient logger;
- preview agrees with publish about what is valid;
- an interrupted multi-step publication resumes rather than restarting, and its handle carries no
  secret;
- every post type is named canonically, and every media kind declares its transport;
- an unconfirmed `create` is never repeated.

## Dependencies: none

A published package declares an empty `dependencies`, and CI enforces it.

No vendor SDK. They wrap the platform's error in their own class and lose exactly what this
library is built on — the HTTP status, the cool-down, the platform's own code. They ship Node
bindings that will not run on Workers. And they move on their own release schedule, breaking
independently of the API they wrap. The product here is an accurate request recipe; the recipe has
to be ours.

The one admissible exception is exotic request-signing cryptography that is genuinely more
expensive to implement than to take — Bluesky's AT Protocol is the standing candidate. It goes in
that one network's `optionalDependencies`, never in the core, is declared in
`scripts/check-zero-deps.mjs` with its reason, and is argued for in the pull request.

## Node built-ins: none

`packages/**` may not import `node:*`. Use `fetch`, `Request`/`Response`, WHATWG streams, Web
Crypto, `URL`, `URLSearchParams`. ESLint refuses the import and `pnpm test:workerd` refuses the
transitive dependency.
