# Changelog

## Unreleased

### 2.0.0 — Phase 9: conformance harness

Adding a network is now "implement the interface and run the suite".

- **New package `@bozonx/social-posting-conformance`** exports `describePlatformContract()`,
  parameterized by a `PlatformModule`, a transport harness and recorded fixtures. Published rather
  than kept internal, because a network maintained outside this repository needs it too.
- **It checks what actually breaks:** every declared post type round-trips; declared limits are
  enforced locally without a wasted API call; each recorded failure maps to the right `ErrorCode`
  with the right `retryable`, `retryAfterMs` and `httpStatus`; an aborted signal makes no call and
  an abort mid-flight stops the publication; publishing mutates no global state and writes to no
  ambient logger; preview agrees with publish; an interrupted multi-step publication resumes
  instead of restarting.
- **Telegram retrofitted onto it**, with real Bot API responses recorded under `test/fixtures/` —
  a 429 with its `retry_after`, a rejected token, a blocked bot, an unknown chat, a moderation
  refusal, an outage. Its existing specs stay as platform-specific additions.
- **Running it caught a real bug:** `TelegramPlatform` issued its Bot API call even when the
  caller's signal was already aborted.
- **The suite runs on both runtimes.** `pnpm test:workerd` now covers every published package, not
  just the core.
- **New:** `pnpm platform <name>` scaffolds a network package — manifest, capability descriptor,
  platform skeleton, credential validator and a spec already wired to the suite — that compiles
  and passes from the first minute.
- **New:** `CONTRIBUTING-PLATFORMS.md`.

### 2.0.0 — Phase 8: packaging and release

- **Renamed.** `social-media-posting-microservice` becomes `@bozonx/social-posting` and
  `@bozonx/social-posting-telegram`. The word "microservice" in the name turns away exactly the
  audience this is for.
- **Straightened build output.** Entry points are `dist/index.js`, not `dist/src/index.js`.
- **Manifests completed:** `repository`, `bugs`, `homepage`, `publishConfig.access` with
  provenance, `sideEffects: false`, and a `prepack` that builds.
- **A `workerd` export condition** sits next to `import`, so a package's Workers compatibility is
  machine-readable rather than a claim in a README.
- **One Node version.** `.nvmrc`, every `engines.node`, the Dockerfile and CI all say 24.
- **CI does the whole gate:** zero-dependency policy, build, lint, typecheck, unit tests,
  per-package typecheck, e2e, the `workerd` run, `publint` and `attw`, the Docker image, and a
  `wrangler deploy --dry-run` that keeps "it runs on Workers" honest.
- **Release on a version tag** publishes both packages with npm provenance, after re-running the
  full gate, and pushes the multi-arch image.
- **New:** `scripts/check-zero-deps.mjs` fails the build when a published package grows a runtime
  dependency, with a documented exception list. A rule nobody checks is not a rule.

### 2.0.0 — Phase 7: the HTTP shell on Hono

The shell now deploys to Node and to Cloudflare Workers from one source.

- **NestJS, Fastify, Pino, class-validator and rxjs are gone from `apps/server`**, replaced by
  Hono and zod. Hono is built on web-standard `Request`/`Response`, so the same code runs on Node,
  Workers, Deno and Bun — which Express (Node-only, callback `req`/`res`) and bare `node:http`
  cannot do.
- **Two entry points, one app.** `entry/node.ts` reads `config.yaml` and drains on SIGTERM;
  `entry/worker.ts` reads `CONFIG_JSON`, because a Worker has no filesystem. Everything between
  them is shared.
- **The shell is strictly stateless.** It parses JSON, calls the library and returns the result —
  including `retryable`, `retryAfterMs` and a serialized `resumeHandle`, so a non-Node caller has
  exactly the same capabilities, and responsibilities, as an in-process consumer.
- **New route `POST /status`** for polling a publication the platform is still processing.
- **`POST /post` accepts a `resume` handle** from a previous failed attempt.
- **Structured logging without Pino.** A small JSON `console` logger, because `console` is the only
  logging primitive every target runtime shares.
- **Two build artefacts in CI:** the Docker image and a `wrangler` deployment.
- **New:** `docs/RUNTIMES.md` states the real Workers boundary structurally — the table is derived
  from each platform's `supportsUrlPassthrough` / `requiresByteUpload` so it cannot drift from the
  code, and it links to Cloudflare's limits rather than copying numbers that go stale.

### 2.0.0 — Phase 6: media pipeline

Supports networks that need real byte uploads, without ever materializing a file.

- **`MediaSource`** replaces the bare URL string at the library's internal boundary: a URL, bytes
  in memory, a `Blob`, a factory that opens a `ReadableStream`, or a reference to media the
  platform already stores. The public request shape is unchanged. There is no Node `Readable`
  anywhere — a `ReadableStream` runs on Node, Workers, Deno and Bun alike.
- **URL passthrough is a first-class fast path.** `requiresByteUpload(source, capabilities)` says
  whether this process has to move the bytes at all. Telegram, Meta's Graph API and TikTok's
  `PULL_FROM_URL` all fetch media themselves — which is what makes a Workers deployment real
  rather than decorative.
- **`MediaFetcher`** streams a remote source, reads type and size from the origin, checks the
  platform's declared limits **before** paying for the download, and keeps checking while
  streaming so an origin that understates `content-length` cannot force an unbounded buffer.
- **Type is identified from the file's own bytes**, not from a URL extension. An extension is a
  claim by whoever wrote the link; a `.jpg` that is really an HTML error page is exactly the
  upload that fails after the bytes are paid for.
- **`runChunkedUpload()`** drives the INIT/APPEND/FINALIZE shape shared by X, TikTok, YouTube and
  LinkedIn: configurable chunk size, per-chunk retry (safe because a chunk is addressed by byte
  offset, so a repeat overwrites rather than appends), and a `ResumeHandle` carrying the offset
  reached, so the host's next attempt continues instead of uploading a second file.
- **Peak memory is one chunk**, whatever the file size — covered by a test that streams 64 MiB and
  asserts the high-water mark.

### 2.0.0 — Phase 5: credentials and OAuth

Unblocks every network that is not Telegram: the ones with expiring tokens.

- **`CredentialProvider`** is where credentials come from and where rotated ones go back to.
  `getCredentials(accountRef)` is consulted per publish; `onCredentialsRefreshed(accountRef, next)`
  hands rotated tokens straight back. The library still stores and encrypts nothing — the host owns
  that, because only the host has durable storage.
- **`StaticCredentialProvider`** covers the trivial case of credentials that live in configuration.
- **`OAuth2TokenRefresher`** performs the `refresh_token` grant with two things each network would
  otherwise get subtly wrong on its own: a clock-skew margin (a token expiring "now" has usually
  expired), and single-flight refresh per account (with rotating refresh tokens, a second
  concurrent refresh presents a token the first already invalidated). `fetch` and Web Crypto only.
- **`IAuthValidator.validate` is async and capability-aware**, returning `{ errors, code }` rather
  than a bare string array, so a validator can distinguish "this token is malformed" from "this
  token is spent". The latter surfaces as `AUTH_REFRESH_REQUIRED`, which is never retryable.
- **`AccountConfig.auth` widened** from `Record<string, string>` to carry an expiry and scopes
  alongside the tokens.
- **New:** `docs/OAUTH.md` fixes the boundary — the authorization-code redirect belongs to the
  host's web application and will not be implemented here.

### 2.0.0 — Phase 4: capability model and generic validation

Validating a new network is now a data structure, not another 150 lines of checks.

- **`validateAgainstCapabilities()`** implements, once, every check a network needs: supported
  types, per-type required and forbidden fields, media counts, media URLs, body length, body
  format, and the fields the platform would drop. Platforms add only what a descriptor cannot
  express, through `IPlatform.validateExtra()`.
- **`previewFromCapabilities()`** is the default preview. `IPlatform.preview` became optional and
  should be implemented only where the network offers a real dry-run. Telegram no longer has one:
  its preview and its publish now run the same checks by construction.
- **Generic type detection.** `detectPostType()` covers the common rules; `IPlatform.detectType`
  overrides it. `TelegramTypeDetector` is now such an override rather than the only implementation.
- **Body rendering layer.** `convertBody()` between plain text, an HTML subset and Markdown,
  `countBodyLength()` with per-platform URL weighting (X counts every URL as 23), `truncateBody()`
  on a word boundary, plus `escapeHtml()` and `escapeMarkdownV2()`.
- **Dead fields closed.** `scheduledAt` and `mode: 'draft'` are now **rejected** by platforms that
  cannot honour them, instead of being reported as "ignored". A contract that silently drops a
  field is worse than one that refuses it. The same applies to `hasSpoiler` on platforms without
  spoilers.
- **Telegram's limits are declared, not hardcoded.** `MAX_MEDIA_GROUP_SIZE` and the 4096-character
  body limit live in its capability descriptor. **Behaviour change:** a body over 4096 characters
  is now refused locally rather than sent and refused by Telegram.
- **`channelId` validation split.** The HTTP layer keeps a structural check (non-empty string or
  integer); what counts as a usable channel is checked by the platform's own hook.
- **New:** `client.getCapabilities(platform)` returns all of the above as data.

### 2.0.0 — Phase 3: the public extension API

A network can now be implemented, registered and published to without touching the core.

- **`PlatformModule`** is the single object a network package exports: its name, its
  capabilities, a `create(deps)` factory and an optional credential validator.
  `@bozonx/social-posting-telegram` exports `telegram`.
- **`createPostingClient({ platforms })`** takes those descriptors; `client.registerPlatform()`
  takes one at runtime. Telegram is no longer instantiated anywhere inside the core.
- **`PlatformCapabilities`** describes a network as data: supported post types and their
  required/forbidden fields, body-length and format rules, media constraints, transport traits
  (`supportsUrlPassthrough`, `requiresByteUpload`), scheduling and draft support, and documented
  rate limits. `IPlatform.supportedTypes` and `supportsCoverWithMedia` are replaced by
  `IPlatform.capabilities`.
- **`client.getCapabilities(platform)`** exposes that to a host UI without attempting a publish.
- **grammY is gone.** Telegram now talks to the Bot API over plain `fetch`, through the shared
  `httpRequest()` helper, so the package has an empty `dependencies`. Its tests assert the JSON
  that actually goes on the wire rather than an SDK's method calls.
- **New:** `examples/custom-platform/` implements a network entirely outside the library, and its
  tests run in CI — proof the seam works from the outside, not just from within this repository.

### 2.0.0 — Phase 2: the result contract

**Breaking.** Everything `publish()` can return other than a plain success is now described by
types, once.

- **One attempt per call.** `retryAttempts` and `retryDelayMs` are gone from the library, from
  `config.yaml` and from the HTTP shell. Stacked with a caller's own retry and a queue's
  `attempts`, the old defaults turned one post into up to 45 platform calls. Retrying is the
  host's job.
- **The one exception is transport-level.** `httpRequest()` repeats a request exactly once when
  the connection failed before the request completed and the body can be replayed. A request the
  platform may have seen is never repeated automatically.
- **`PlatformError`** carries `code`, `retryable`, `retryAfterMs`, `httpStatus`, `platformCode`,
  `resumeHandle` and `cause`. Platforms throw it; the core no longer sniffs error strings or
  reads vendor-specific fields.
- **New error codes:** `CONTENT_REJECTED`, `QUOTA_EXCEEDED`, `AUTH_REFRESH_REQUIRED`.
- **Telegram error mapping moved into `@bozonx/social-posting-telegram`**, and it now reads
  `parameters.retry_after` into `retryAfterMs`. `'fetch failed'` / `'undici'` string matching and
  grammY field access are gone from the core.
- **Publication status.** `publish()` returns `{ status: 'published' | 'processing', postId?,
  url?, handle?, checkAfterMs? }`, and `IPlatform.checkStatus(handle)` is available for networks
  that materialize posts asynchronously. Nothing in this library polls.
- **Resumable operations.** A failure that left progress behind carries a JSON-serializable
  `resumeHandle`; `post(request, { resume })` continues from that step. Without this the
  "the host retries" model is not merely incomplete but wrong for multi-step publications.
- **`post()` takes an options object** (`{ signal, resume }`) instead of a bare `AbortSignal`.
- **Error responses gained** `retryable`, `retryAfterMs`, `httpStatus`, `platformCode` and
  `resumeHandle`, over HTTP as well as in-process.
- **New:** `docs/DELIVERY-SEMANTICS.md` documents the duplicate-risk window and the host pattern.

### 2.0.0 — Phase 1: framework-free core

**Breaking.** The repository is now a pnpm workspace, and the library is a framework-free
package rather than a NestJS application with a second run mode.

- **Split into packages.** `@bozonx/social-posting` (core, zero runtime dependencies),
  `@bozonx/social-posting-telegram` (Telegram), and `apps/server` (the HTTP shell, never
  published to npm).
- **NestJS is gone from the core.** No `@Injectable`, no `@Module`, no `rxjs`, no
  `reflect-metadata`. Collaborators are passed through constructors.
- **`createPostingClient` no longer touches global state.** It used to call
  `NestLogger.overrideLogger(...)`, which hijacked logging for the entire host process.
  A logger is now passed in and used by that client alone.
- **`createPostingClient` no longer hardcodes Telegram.** Pass the platforms you want through
  `platforms`/`authValidators`, or add them later with `client.registerPlatform()`.
- **The extension contract is public.** `IPlatform`, `PlatformPublishResponse`,
  `IAuthValidator`, `PlatformRegistry`, `AuthValidatorRegistry` and the error types are
  exported, so a network can be implemented outside this repository.
- **Idempotency removed.** `IdempotencyService` kept its records in a single process's memory,
  so it deduplicated nothing as soon as a second replica existed, and it answered concurrent
  duplicates with `VALIDATION_ERROR`. Deduplication belongs to the host, which has durable
  state. `@nestjs/cache-manager` and `cache-manager` are gone with it.
- **`class-validator` removed from the core**, replaced by `validatePostRequest()`. DTO classes
  became plain interfaces: `PostRequestDto` → `PostRequest`, `PostResponseDto` → `PostResponse`,
  `ErrorResponseDto` → `ErrorResponse`, `PreviewResponseDto` → `PreviewResponse`,
  `PreviewErrorResponseDto` → `PreviewErrorResponse`. The HTTP shell keeps a decorated
  `PostRequestDto` of its own for request-body validation.
- **The core throws typed errors** (`PostingError`, `ValidationError`, `AbortedError`) instead
  of Nest's `BadRequestException`.
- **`MediaInputHelper.getFileId()` → `getPlatformRef()`**, and `toTelegramInput()` moved to the
  Telegram package: neither Telegram nor grammY appears in the core any more.
- **Web-standard discipline is enforced.** Published packages may not import Node built-ins
  (ESLint `no-restricted-imports`), and the core test suite also runs inside `workerd`
  (`pnpm test:workerd`).
- **Tests run on Vitest** instead of Jest, as one workspace run with a project per package.
- **`PostingClient.destroy()` removed.** The client owns no resources to release.

- Fixed the Docker runtime entry point to launch the Nest build output at `dist/main.js`.
- Upgraded `class-validator` to 0.15.1 after validating custom validators and request DTOs.
- Split CI validation from tag-only multi-architecture image releases and aligned the fleet-wide
  Renovate policy.
- Standardized fleet scripts, environment handling, service identity, draining health checks,
  non-root multi-stage Docker build, Compose limits, flat ESLint and Renovate configuration.

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Bearer Token Authentication**:
  - Optional API authentication using `AUTH_BEARER_TOKENS` environment variable.
  - Supports multiple comma-separated tokens.
  - Global `BearerAuthGuard` with `@Public()` decorator support for bypassing auth.
- **Library Mode**: Support for using the package as a standalone TypeScript library.
  - `createPostingClient`: New entry point for programmatic usage without NestJS HTTP server.
  - Full configuration isolation (no environment variables or external YAML files read).
  - Explicit exports for services, DTOs, and types.
- **Customizable Logging**:
  - `ILogger` interface for injecting custom logger implementations.
  - `ConsoleLogger` with configurable log levels.
- **Automatic Type Detection (`type: auto`)**: New default post type that automatically determines the Telegram API method based on provided media fields
  - Priority order: `media[]` → `document` → `audio` → `video` → `cover` → text message
  - Validation for ambiguous media fields (multiple conflicting media types)

- **New Media Fields**:
  - `audio` - Audio file support (MP3, M4A, OGG) via `sendAudio`
  - `document` - Document/file support (any file type) via `sendDocument`

- **MediaInput Type**: Media field format supporting:
  - Object with options: `{ "src": "...", "hasSpoiler": true, "type": "image" }`
  - `src` - URL or Telegram file_id for reusing previously uploaded files
  - `hasSpoiler` - Hide media under spoiler animation (for sensitive content)
  - `type` - Explicit media type for albums (image, video, audio, document)

- **New Services**:
  - `TelegramTypeDetector` - Service for automatic type detection based on media fields
  - `AmbiguousMediaValidator` - Validator for detecting conflicting media fields

- **Validation Improvements**:
  - Required field validation for explicit types
  - Warning logs for ignored fields (title, description, tags, etc.)

- **Unit Tests**: Comprehensive test coverage (195 tests)
  - `TelegramProvider` tests (38 tests)
  - `TelegramTypeDetector` tests (16 tests)
  - `AmbiguousMediaValidator` tests (12 tests)
  - `MediaInputHelper` tests (28 tests)
  - `MediaInputValidator` tests (20 tests)

- **Idempotency Support**:
  - Best-effort idempotency with `idempotencyKey`
  - In-memory cache per instance with configurable TTL (`common.idempotencyTtlMinutes`)
  - Cached reuse of both successful and error responses for identical requests

- **Preview Endpoint (`POST /preview`)**:
  - Validate request parameters without publishing
  - Preview body conversion (markdown → HTML, etc.)
  - Get warnings about ignored fields and length limits
  - Returns `detectedType`, `convertedBody`, `targetFormat`, `convertedBodyLength`, `warnings`

### Changed

- **`maxBody` Configuration Refactoring**:
  - Added `maxBody` parameter to account configuration (optional, per-account limit)
  - Request `maxBody` overrides account's `maxBody`
  - Introduced a hard service limit of 500,000 characters for body length (not configurable)

- **Media Validation Refactoring**:
  - Replaced strict validation errors for multiple media fields with soft priority-based logic
  - Priority order: `media[]` (1) → `document` (2) → `audio` (3) → `video` (4)
  - For Telegram: `cover` (priority 5) is ignored if higher priority media is present (instead of throwing error)
  - `AmbiguousMediaValidator` renamed to `MediaPriorityValidator`

- Default `type` changed from `post` to `auto`
- Media fields (`cover`, `video`, `media[]`) now accept `MediaInput` type instead of plain strings
- `TelegramProvider.supportedTypes` now includes `AUTO` and `AUDIO`
- Telegram-specific limits (text length, album size) are now delegated to the Telegram API instead of being validated by the microservice
- **Response format for `raw` field**: Now returns `{ok: true, result: {...}}` format to match standard Telegram Bot API and n8n Telegram node behavior (previously returned only the `result` content)

### Fixed

- Import paths in `TelegramTypeDetector` service
- DI registration for `TelegramTypeDetector` in `ProvidersModule`
- **TypeError in `buildPostUrl`**: Fixed `chatId.startsWith is not a function` error when `chatId` is passed as a number instead of string (e.g., from n8n or YAML config)
- **Library Mode Platform Registration**: Fixed bug where platforms were not being registered when using `createPostingClient()`, causing "Platform not supported" errors. Now properly instantiates and registers TelegramPlatform and TelegramAuthValidator with their dependencies.

---

## [0.1.0] - 2025-11-30

### Added

- Initial MVP release
- Telegram provider with support for:
  - Text posts (`sendMessage`)
  - Images (`sendPhoto`)
  - Videos (`sendVideo`)
  - Albums (`sendMediaGroup`)
  - Documents (`sendDocument`)
- Content conversion (HTML ↔ Markdown ↔ Text)
- Media URL validation
- Retry logic with ±20% jitter
- YAML configuration with environment variable substitution
- Platform-specific options support
- Health check endpoint
