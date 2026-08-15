# Package Readiness & Platform-Extensibility Plan

**Status:** proposed
**Created:** 2026-08-15
**Goal:** bring this repository to the point where the *only* remaining work is adding new
social networks — each new network being an isolated directory implementing a stable contract,
plus a fixture-driven conformance test run.

## Context

The consuming product (BloggerDog) will stop calling this project over HTTP and will instead
embed it **as an npm package, in-process, inside its BullMQ worker**. The HTTP application
(`src/main.ts`) and the n8n node stay in this repository as thin shells over the same library,
for standalone users.

That decision changes the responsibility split:

| Concern | Owner after the change |
| --- | --- |
| Durable post state, dedupe of already-published posts | Host application (DB row) |
| Retry policy, backoff, dead-lettering | Host application (BullMQ) |
| Per-account rate limiting across processes | Host application (Redis) |
| Payload → platform API translation | **This package** |
| Error classification (retryable / permanent / rate-limited) | **This package** |
| Capability metadata (limits, supported types, formats) | **This package** |
| Credential refresh mechanics (OAuth) | **This package**, persistence delegated to host |

Everything below follows from that table.

---

## Current state — audit

### What already works

- `IPlatform` / `PlatformRegistry` / `IAuthValidator` / `AuthValidatorRegistry` give a real
  extension seam; there is no switch-case dispatch.
- Dual entry points already exist: `src/main.ts` (HTTP) and `src/library.ts`
  (`createPostingClient`), with `tsconfig.lib.json` excluding `main.ts` / `app.module.ts`
  from the library build.
- No TypeScript path aliases are used inside `src/` — plain `tsc` output is directly usable,
  no alias rewriting needed.
- Library mode is documented as isolated from `process.env` and `config.yaml`.
- ~5000 LOC of tests across 20 unit specs and 4 e2e specs.
- Graceful shutdown, request timeout with `AbortSignal` propagation, and abort-aware sleep
  are implemented properly.

### Blocking problems for in-process embedding

1. **Global NestJS logger mutation.** `createPostingClient` calls
   `NestLogger.overrideLogger(...)` (`src/library.ts`). The host is itself a NestJS
   application; creating a client would silently hijack the host's logging for the whole
   process. This is a hard blocker.
2. **Telegram is hardcoded in the factory.** `createPostingClient` instantiates
   `MediaService`, `TelegramTypeDetector`, `TelegramPlatform`, `TelegramAuthValidator`
   inline. Every new network requires editing the factory, and every consumer pays for
   every network's dependencies.
3. **No public extension contract.** `src/index.ts` does not export `IPlatform`,
   `PlatformPublishResponse`, `IAuthValidator`, or the registries. A platform cannot be
   written outside this package, and `PostingClient` has no `registerPlatform()`.
4. **Dead idempotency wiring.** `createPostingClient` builds `IdempotencyService` through
   `new (IdempotencyService as any)(cacheManager, appConfigService)` with an all-no-op cache.
   The `@nestjs/cache-manager` + `cache-manager` runtime dependencies are paid for nothing.
5. **Idempotency is per-process and unsound.** `IdempotencyService` keeps a `Map` in memory;
   with more than one replica behind a load balancer there is no dedupe at all. Concurrent
   duplicates return `VALIDATION_ERROR`, which is a semantically wrong code.
6. **Retry duplication.** `PostService.publish` wraps `platform.publish` in
   `retryWithJitter(..., appConfig.retryAttempts /* default 3 */, ...)`. Stacked with the
   host's HTTP retry and BullMQ `attempts: 5`, one post can hit the platform API up to
   45 times. In embedded mode the package must attempt **once** by default.
7. **Retry information is not surfaced.** `getErrorCode` detects `RATE_LIMIT_ERROR`, but
   `retry_after` from the platform is never read or returned (`grep retry_after` → nothing).
   The host cannot honour platform backoff.
8. **Untyped errors.** `post.service.ts` classifies by sniffing `error: any` — string
   matching on `'fetch failed'`, `'undici'`, and reading grammY-shaped fields
   (`error.payload`, `error.description`) in the *generic* layer. Telegram specifics have
   leaked into the core.
9. **Heavy runtime dependency surface.** `@nestjs/common`, `@nestjs/core`,
   `@nestjs/cache-manager`, `cache-manager`, `class-validator`, `class-transformer`,
   `rxjs`, `reflect-metadata` are all hard `dependencies` for library consumers.

### Extensibility gaps — what every network after Telegram will need and cannot get today

10. **Only static credentials are supported.** `auth: Record<string, string>` with synchronous
    string validators. X, LinkedIn, TikTok, YouTube, Meta/Threads, Pinterest and Reddit all
    use OAuth2 with expiring, refreshable tokens. There is no hook to obtain a fresh token
    or to hand a rotated refresh token back to the host for persistence. **This is the single
    largest missing abstraction — no OAuth network can be added until it exists.**
11. **No upload primitives.** `MediaService` is 45 lines that validate a URL string. Telegram
    accepts remote URLs; almost nobody else does. TikTok, YouTube, X (INIT/APPEND/FINALIZE),
    LinkedIn (register → PUT → create) and VK (getUploadServer → POST → save) all need
    multi-step, streamed, chunked, resumable uploads with per-chunk retry and abort support.
12. **No deferred-result model.** `IPlatform.publish()` must return a final result. TikTok and
    YouTube return a processing handle; the post materialises minutes later and may still fail
    moderation. There is no `checkStatus()` in the contract and no `PROCESSING` outcome.
13. **No capability descriptor.** Limits are ad-hoc: `supportedTypes` and
    `supportsCoverWithMedia` on the interface, `MAX_MEDIA_GROUP_SIZE = 10` hardcoded inside
    `TelegramPlatform`, `maxBody` in account config. The host needs machine-readable limits
    (body length, media counts, mime types, file sizes, aspect ratios, body formats,
    native scheduling/draft support, rate-limit quotas) to validate in its UI before enqueuing.
14. **Preview logic will be copy-pasted.** `getRequiredFieldsErrors`, `getIgnoredFieldsWarnings`
    and `getIgnoredMediaWarnings` are ~150 hand-written lines inside `TelegramPlatform`. Written
    once per network, this becomes the dominant cost of adding a network.
15. **No body rendering layer.** `bodyFormat` is a free-form string each platform reinterprets.
    Target formats differ per network (plain, HTML subset, MarkdownV2), as do truncation rules
    and URL-length counting.
16. **`channelId` validation is Telegram-shaped.** `IsChannelId` encodes `@name` / `-100…`
    in the generic DTO layer. Other networks use page ids, boards, subreddits, profile URNs.
17. **`scheduledAt` and `mode: 'publish' | 'draft'` are dead fields.** They exist in
    `PostRequestDto` and are only ever reported as "ignored" by Telegram. Either implement or
    remove — a contract that silently drops input is worse than one that rejects it.
18. **Type auto-detection is Telegram-specific** (`TelegramTypeDetector`), with no generic
    default.

### Packaging and CI gaps

19. CI (`.github/workflows/docker-image.yml`) runs unit tests + `pnpm build` + Docker build only.
    No lint, no typecheck, no e2e, **no `build:lib` verification**, no npm publish job.
20. `package.json` has no `repository`, `bugs`, `homepage`, `publishConfig`, `sideEffects`,
    or `prepack`. Publishing is a manual `pnpm lib:publish`.
21. `engines.node` says `>=24.0.0`; `AGENTS.md` says Node 22. CI derives its Node version from
    `engines`, so the docs are wrong.
22. No platform conformance test suite, and `nock` is present only in `test/setup/unit.setup.ts`
    (net-connect blocking), not as a fixture mechanism for platform API contracts.
23. `examples/test-platform-registration.ts` is named for external registration but only
    exercises the built-in Telegram wiring.

---

## Plan

Phases are ordered so that each one is independently shippable, and so that BloggerDog can
integrate after Phase 2 without waiting for the rest.

### Phase 1 — Make the library safe to embed

*Objective: `createPostingClient` can be called inside another NestJS process without side effects.*

- [ ] **1.1 Remove `NestLogger.overrideLogger`** from `src/library.ts`. Inject the `ILogger`
      explicitly into every service instead of relying on Nest's ambient `Logger`. Introduce
      a `LOGGER` token; in HTTP mode bind it to the Nest logger, in library mode to the
      caller-supplied `ILogger`.
- [ ] **1.2 Replace `new Logger(X.name)` field initialisers** across `src/modules/**` with the
      injected logger. This is the mechanical part of 1.1 (29 files import `@nestjs/common`).
- [ ] **1.3 Delete the fake cache manager** and the `as any` construction of
      `IdempotencyService` in library mode.
- [ ] **1.4 Make idempotency pluggable and off by default.** Extract an
      `IdempotencyStore` interface (`get`/`setProcessing`/`setCompleted`). Ship
      `InMemoryIdempotencyStore` (used by the HTTP app, single-replica caveat documented) and
      accept a custom store via config. In library mode the default is **no store** —
      the host owns dedupe. Move `@nestjs/cache-manager` / `cache-manager` to
      `optionalDependencies` and behind the HTTP shell.
- [ ] **1.5 Verify a clean library consumption path.** Add `examples/embedded-nest/` — a
      minimal NestJS app that creates a client, publishes a mocked post, and asserts its own
      logger was not hijacked. Wire it into CI.

**Done when:** the library can be instantiated twice in one process with different loggers and
different accounts, with no global state touched.

### Phase 2 — Retry & error contract

*Objective: the host, not the package, decides whether and when to retry.*

- [ ] **2.1 Default `retryAttempts` to `1` in library mode** (keep the configurable value for
      the HTTP app, where no smarter caller exists). Document the change loudly in
      `docs/CHANGELOG.md` — it is a behavioural breaking change.
- [ ] **2.2 Introduce a typed `PlatformError`** (`src/common/errors/platform-error.ts`) with:
      `code: ErrorCode`, `retryable: boolean`, `retryAfterMs?: number`,
      `httpStatus?: number`, `platformCode?: string`, `cause`. Platforms throw it; the core
      never sniffs strings again.
- [ ] **2.3 Move grammY-specific error mapping into `TelegramPlatform`.** Read
      `error.parameters.retry_after` and translate it to `retryAfterMs`. Remove
      `error.payload` / `error.description` handling from `post.service.ts`.
- [ ] **2.4 Surface `retryable` and `retryAfterMs` in `ErrorResponseDto`** so both the HTTP
      response and the in-process return value carry them. Add `ErrorCode.CONTENT_REJECTED`
      (moderation / policy) and `ErrorCode.QUOTA_EXCEEDED` (daily posting quota), which are
      permanent-but-not-auth failures common outside Telegram.
- [ ] **2.5 Add a transport-level micro-retry only.** A single retry on connection reset before
      any bytes of the request body are sent is safe; a retry after the request completed is
      not. Make that distinction explicit in code and in the JSDoc.
- [ ] **2.6 Document the duplicate-post risk window** per platform in a new
      `docs/DELIVERY-SEMANTICS.md`: which networks offer native idempotency, which allow
      "list recent posts" reconciliation, and which are irreducibly at-least-once.

**Done when:** BloggerDog can delete both its HTTP retry wrapper and its reliance on the
package's internal retry, and drive backoff purely from `retryable` + `retryAfterMs`.

### Phase 3 — Public extension API

*Objective: a network can be implemented without editing core files.*

- [ ] **3.1 Export the contract** from `src/index.ts`: `IPlatform`, `PlatformPublishResponse`,
      `IAuthValidator`, `PlatformCapabilities`, `PlatformError`, `ErrorCode`,
      `MediaInput`, and the base helper classes.
- [ ] **3.2 Add `PlatformModule` descriptors.** Each network exports a single factory object:
      ```ts
      export const telegramPlatformModule: PlatformModule = {
        name: 'telegram',
        capabilities: telegramCapabilities,
        create: (deps) => new TelegramPlatform(deps),
        authValidator: new TelegramAuthValidator(),
      };
      ```
      `deps` carries the logger, the media fetcher, the HTTP client and the token provider.
- [ ] **3.3 Change `createPostingClient` to take `platforms: PlatformModule[]`** instead of
      hardcoding Telegram. Add subpath exports so consumers import only what they use:
      `@bozonx/social-posting/platforms/telegram`. Update `PlatformsModule` (HTTP mode) to
      register from the same descriptor list.
- [ ] **3.4 Expose `client.getCapabilities(platform)`** and
      `client.getRegisteredPlatforms()` on `PostingClient`, so the host UI can render limits.
- [ ] **3.5 Per-platform dependency isolation.** Move `grammy` to `peerDependencies` +
      `peerDependenciesMeta.optional`, and lazily `import()` it from the Telegram descriptor.
      Establish this as the rule for every future network. Prefer plain `fetch` over vendor
      SDKs — only take an SDK when it clearly pays for itself.
- [ ] **3.6 Rewrite `examples/test-platform-registration.ts`** to register a *custom, in-file*
      platform, proving the seam works from outside the package.

**Done when:** `import { createPostingClient } from '@bozonx/social-posting'` with zero platform
modules installs nothing platform-specific, and a third party can publish their own network.

### Phase 4 — Capability model and generic validation

*Objective: kill the ~150 lines of hand-written preview logic per network.*

- [ ] **4.1 Define `PlatformCapabilities`** (`src/modules/platforms/base/capabilities.ts`):
      supported post types; per-type required and forbidden fields; `maxBodyLength` and how
      URLs are counted; `maxMediaCount` / `minMediaCount`; allowed mime types and max byte
      size per media kind; allowed aspect ratios and durations for video; supported
      `bodyFormat` values and the canonical target format; `supportsNativeScheduling`,
      `supportsDraft`, `supportsSpoiler`, `supportsCoverWithMedia`; declared rate-limit
      quotas.
- [ ] **4.2 Write a generic validator** driven entirely by the descriptor, producing the
      existing `errors` / `warnings` / `ignoredFields` shape. Platforms get an optional
      `validateExtra(request)` hook for genuinely bespoke rules.
- [ ] **4.3 Reduce `TelegramPlatform` to the descriptor plus its hook.** Delete
      `getRequiredFieldsErrors`, `getIgnoredFieldsWarnings`, `getIgnoredMediaWarnings`,
      and the hardcoded `MAX_MEDIA_GROUP_SIZE`. Existing specs must still pass unchanged —
      this is the proof the generic path is equivalent.
- [ ] **4.4 Make `preview()` generic by default**: validation from the descriptor, with
      `IPlatform.preview` becoming optional and only overridden where a real platform-side
      dry-run exists.
- [ ] **4.5 Generic type auto-detection** from the media fields, with `TelegramTypeDetector`
      demoted to an override.
- [ ] **4.6 Move `channelId` validation into the platform layer.** Replace the global
      `IsChannelId` with a per-platform `validateTarget()` fed by the descriptor.

**Done when:** a new network's validation is a data structure, not code.

### Phase 5 — Credentials and OAuth

*Objective: unblock every non-Telegram network.*

- [ ] **5.1 Define `CredentialProvider`:**
      ```ts
      interface CredentialProvider {
        getCredentials(accountRef: string): Promise<ResolvedCredentials>;
        onCredentialsRefreshed?(accountRef: string, next: ResolvedCredentials): Promise<void>;
      }
      ```
      Static config accounts become the trivial implementation; the host passes one backed by
      its own encrypted storage.
- [ ] **5.2 Add an OAuth2 refresh helper** in `src/common/auth/` handling the standard
      `refresh_token` grant, clock skew, and **single-flight refresh** (concurrent publishes
      for one account must not race two refreshes). Platforms declare their token endpoint and
      scopes; the helper does the rest.
- [ ] **5.3 Make `IAuthValidator.validate` async** and capability-aware, so it can distinguish
      "malformed" from "expired and unrefreshable".
- [ ] **5.4 Add `AUTH_REFRESH_REQUIRED` as a distinct error outcome**, so the host can flag a
      channel as needing re-authorisation instead of retrying forever.
- [ ] **5.5 Document the connect flow** in `docs/OAUTH.md`: the package never runs the
      authorisation-code redirect (that belongs to the host's web app); it consumes and
      refreshes tokens only. Make that boundary explicit before the first OAuth network lands.

**Done when:** a network with expiring tokens can be implemented with no changes to core.

### Phase 6 — Media pipeline

*Objective: support networks that require real uploads.*

- [ ] **6.1 Introduce `MediaSource`** — a URL, a `Buffer`, or a `Readable` factory — replacing
      the URL-string-only `MediaInput.src` at the internal boundary. Keep the public DTO
      backward compatible.
- [ ] **6.2 Add `MediaFetcher`**: streams a remote source, resolves content-length and mime
      (from headers, falling back to magic-byte sniffing rather than URL extension), enforces
      the descriptor's size limits *before* uploading, and honours `AbortSignal`.
- [ ] **6.3 Add `ChunkedUploader`**: a reusable INIT/APPEND/FINALIZE-shaped driver with
      configurable chunk size, per-chunk retry, and resume-from-offset. This is the shared
      substrate for X, TikTok, YouTube and LinkedIn.
- [ ] **6.4 Never buffer whole files in memory.** Add a test that uploads a large synthetic
      stream and asserts peak RSS stays bounded — worker processes will run many jobs
      concurrently.
- [ ] **6.5 Keep URL-passthrough as a first-class fast path** for networks that accept remote
      URLs (Telegram), since the host serves media from object storage with pre-signed URLs.

**Done when:** a network requiring a three-step chunked upload needs no new HTTP plumbing.

### Phase 7 — Deferred results, scheduling and drafts

- [ ] **7.1 Extend the publish outcome** to `{ status: 'published' | 'processing', postId,
      url?, checkAfterMs? }`, and add an optional `IPlatform.checkStatus(handle)` returning
      published / processing / failed with a reason.
- [ ] **7.2 Document the host-side polling contract** — the package exposes the check, the
      host schedules it as a follow-up job. No polling loop inside the package.
- [ ] **7.3 Resolve `scheduledAt` and `mode`.** Implement them where the network supports
      them natively (declared via `supportsNativeScheduling` / `supportsDraft`) and **reject**
      them with a clear validation error everywhere else. Silently ignoring input is the one
      outcome to eliminate.

**Done when:** TikTok/YouTube-style asynchronous publication is expressible in the contract.

### Phase 8 — Packaging and release engineering

- [ ] **8.1 Rename the package** to something library-shaped (e.g. `@bozonx/social-posting`);
      "microservice" in the package name is now misleading. Keep the repo name if you prefer.
- [ ] **8.2 Flatten the build output** so entry points are `dist/index.js` rather than
      `dist/src/index.js` (set `rootDir: "src"` in `tsconfig.lib.json` and update `exports`).
- [ ] **8.3 Complete `package.json` metadata:** `repository`, `bugs`, `homepage`,
      `publishConfig.access`, `sideEffects: false`, `prepack` running `build:lib`, and
      subpath `exports` for `./platforms/*`.
- [ ] **8.4 Reconcile the Node version.** Pick one, fix `engines`, `AGENTS.md`, the Dockerfile
      and CI together.
- [ ] **8.5 Extend CI** with lint, typecheck, e2e, `build:lib`, and a publish job triggered on
      a version tag with npm provenance. Add `attw` / `publint` to catch broken ESM type
      resolution before consumers do.
- [ ] **8.6 Declare the n8n sub-package** in a root `pnpm-workspace.yaml` (it currently carries
      its own lockfile with no workspace declaration), or split it into its own repository.

### Phase 9 — Conformance test harness

*Objective: adding a network means implementing an interface and running a shared suite.*

- [ ] **9.1 Write `test/contract/platform-contract.suite.ts`**, parameterised by a
      `PlatformModule` plus a fixtures directory. It asserts: every declared supported type
      round-trips; declared limits are actually enforced; errors map to the right `ErrorCode`
      with correct `retryable`; abort signals are honoured mid-flight; no global state is
      mutated.
- [ ] **9.2 Establish nock-recorded fixtures per network** under
      `test/fixtures/<platform>/`, including the error responses (429 with headers, 401,
      moderation rejection) — those paths are what break in production.
- [ ] **9.3 Retrofit Telegram onto the suite** and keep the existing specs as the
      platform-specific extras.
- [ ] **9.4 Add a `CONTRIBUTING-PLATFORMS.md` checklist** and a `platform` scaffold script
      that generates the directory, descriptor stub, and a suite-wired spec.

**Done when:** `pnpm test:contract` is the gate for accepting a new network.

---

## Definition of done

Adding a social network consists of exactly this, with no core edits:

```
src/modules/platforms/<network>/
  <network>.capabilities.ts   # data: limits, supported types, formats, quotas
  <network>.platform.ts       # publish() (+ checkStatus() if async), error mapping
  <network>-auth.validator.ts # credential shape validation
  index.ts                    # PlatformModule descriptor
test/fixtures/<network>/…     # recorded API responses, success and failure
test/unit/<network>.spec.ts   # contract suite + platform-specific extras
```

plus one line in the subpath export map and one entry in the README support table.

## Suggested sequencing

- **Phases 1–2** are the integration blockers. Ship them first; BloggerDog can switch to the
  in-process driver immediately afterwards, while still only supporting Telegram.
- **Phase 3** next — it is cheap and stops the factory from accreting more hardcoding.
- **Phases 4–6** are the real investment. Do not start the second network before Phase 5 (OAuth)
  and Phase 6 (uploads) exist; otherwise their absence gets worked around inside the platform,
  and the workaround becomes the template for every network after it.
- **Phase 7** can wait until the first asynchronous network (TikTok or YouTube) is actually
  scheduled.
- **Phases 8–9** should land alongside Phase 3, since publishing and conformance testing are
  what make the extension seam real rather than nominal.

## Recommended network order

Ordered by how much new infrastructure each one forces:

1. **VK** — static token, but exercises the multi-step upload path (Phase 6) without OAuth.
2. **Mastodon / Bluesky** — small, well-documented APIs; good second validation of the
   capability model, minimal dependencies.
3. **LinkedIn** — first OAuth network; exercises Phase 5 end to end.
4. **X** — chunked upload plus strict character-counting rules.
5. **Meta (Instagram / Facebook / Threads)** — container-based publishing, long-lived token
   exchange; use the Graph REST API directly rather than the vendor SDK.
6. **TikTok / YouTube** — deferred results and moderation outcomes; needs Phase 7.

## Open questions

- Should the HTTP application keep its in-memory idempotency at all, or require an external
  store when run with more than one replica? Current behaviour is silently unsound at scale.
- Package name and npm scope — needs a decision before Phase 8.
- Whether the n8n node stays in this repository long-term; it constrains the release cadence.
