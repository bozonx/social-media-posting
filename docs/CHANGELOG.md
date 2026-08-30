# Changelog

## Unreleased

### Breaking: the core's type model

These land as one piece. Compatibility with the previous shapes is deliberately not kept — the
library is being brought to the right form once, while there is a single adapter and a single
consumer, rather than fifteen times later.

| Change                                     | What stops working                                                     |
| ------------------------------------------ | ---------------------------------------------------------------------- |
| Canonical post-type registry, `shortVideo` | an arbitrary string in `capabilities.postTypes` now fails registration |
| `TargetInput` / `PlatformTarget`           | reading `target` as a scalar inside an adapter                         |
| `apiBaseUrl` on the account                | a base URL baked into a platform package                               |
| `PostRequest<TExtra>`                      | a flat `extra` mixing several networks' keys                           |
| `transport` on `MediaConstraints`          | every existing media descriptor: the field is required                 |
| `UNKNOWN_OUTCOME` in `ErrorCode`           | exhaustive `switch` statements over error codes                        |
| Versioned, secret-free `ResumeHandle`      | stored handles with secrets; adapters must reject unknown versions     |
| `ArticleDocument` for `PostType.ARTICLE`   | an `article` made of one `body` plus `media[]`                         |
| `adaptedRequest` in `preview()`            | host-side per-network formatters                                       |

### Added

- **Three video networks: `@bozonx/social-posting-youtube`, `@bozonx/social-posting-vimeo` and
  `@bozonx/social-posting-dailymotion`.** All three publish `processing` rather than `published`,
  because an accepted upload is not a watchable video, and all three carry the wait budget in
  `capabilities.asyncProcessing` so a host stops guessing at a global timeout. YouTube and Vimeo
  resume interrupted uploads from the offset the _network_ reports, not the one the host stored;
  neither resume handle carries the session URL, which is a bearer secret in both protocols.
  Dailymotion issues no upload resume handle at all, because its upload endpoint genuinely cannot
  be resumed.
- `capabilities.asyncProcessing` (`supported`, `typicalSecs`, `maxWaitSecs`, `pollIntervalSecs`):
  how long a network's own processing may take. The one number a host cannot invent for itself —
  a Telegram message is live on the first check, while a YouTube upload routinely transcodes for
  longer than a quarter of an hour, and a single global timeout serving both either gives up on
  YouTube or holds a Telegram job open for nothing.
- `ResolvedAccountConfig.accountRef`: the account name the request used. An OAuth2 adapter needs
  it to hand a rotated token back to the host's `CredentialProvider`, which addresses accounts by
  name.
- A `CredentialProvider` may now be the **only** source of an account. A host whose accounts live
  in a database — one row per channel, created while the process runs — has nothing to put in
  static configuration, and requiring an entry there forced it back onto inline `auth`, which is
  the one path that cannot rotate a refresh token. `PostingConfig.hasAccount()` exposes the check.

- `PostType.SHORT_VIDEO`, plus `thread`, `event` and `live` as reserved names;
  `CANONICAL_POST_TYPES`, `isCanonicalPostType()` and `isPlatformPostType()`. A descriptor may
  only declare a canonical name or an `x-<platform>-…` extension, and `detectPostType()` never
  infers `shortVideo` or `story`.
- Media descriptors state who moves the bytes (`transport: 'push' | 'pull' | 'both'`,
  `requiresPubliclyFetchableUrl`, `urlMustRemainAvailableForSecs`) and what they accept
  (`containers`, `videoCodecs`, `audioCodecs`, `minFrameRate`/`maxFrameRate`, `requiresCover`).
  Mismatches are refused before the first HTTP call.
- Structural `target`: `PlatformTarget`, `TargetInput`, `normalizeTarget()`, and
  `capabilities.targetSchema` validated like `extra`. Adapters only ever see the normalized form.
- `AccountConfig.apiBaseUrl` with `capabilities.requiresApiBaseUrl`, for per-instance networks.
- `IPlatform.resolveCapabilities()` with `mergeCapabilities()` merge semantics in the core, plus
  `client.resolveCapabilities()`. The library caches nothing; `cacheableForSecs` is the host's to
  honour. `rateLimits.quotaCost`/`quotaKind` and `IPlatform.getQuota()` for networks that report
  a remaining allowance.
- `ErrorCode.UNKNOWN_OUTCOME`, `PlatformError.outcomeUnknown` and `IPlatform.reconcile()`: an
  unconfirmed `create` is reconciled, deduplicated by idempotency key, or reported — never
  repeated.
- Resume handles are scanned for secrets on their way out (`findResumeHandleSecrets()`,
  `sanitizeResumeHandle()`, `strictResumeHandles` in the client and server config). New handles
  are emitted as format version `1`; strictness is an explicit host policy, never inferred from
  `NODE_ENV`.
- `buildMultipartFormData()`, `runSinglePartUpload()` and `runUploadSequence()` — Web-API upload
  helpers alongside the existing chunked uploader.
- `ArticleDocument` for `PostType.ARTICLE`, `thread: PostSegment[]` with `capabilities.thread`,
  and a reserved `IPlatform.edit()`.
- `BodyLengthRule.countUnit` (`utf16` | `graphemes` | `utf8Bytes`) and `countUnits()`, so a
  network is measured in its own unit — Bluesky's 300 is 300 graphemes, not 300 UTF-16 units.
- `adaptRequest()` and `adaptedRequest`/`requiredMediaUrlLifetimeSecs` in `preview()`.
- Preview has one authoritative path through the capability descriptor and `validateExtra`; custom
  adapter preview hooks were removed. Type-specific body limits and every thread segment are
  reflected in `adaptedRequest`.
- Reconciliation uses the request timeout and abort signal. An `absent` reconciliation or an
  idempotency key proves a retry safe, so the returned failure is retryable.
- `PlatformModule.dialect` and `deriveModule()`, so one package can serve a family of networks.
- `POST /post/stream` in the HTTP shell: media as an `application/octet-stream` body, outside the
  JSON body limit, handed to the adapter as a `ReadableStream`. Video bytes are refused on the
  JSON endpoint.
- `apps/server/.env.example`.

### Changed

- Telegram: media declares `transport: 'pull'`; the chat is addressed through the normalized
  target, and a forum topic is `target.messageThreadId` (the `message_thread_id` extra field is
  gone); the descriptor declares `auth.requiresTarget`.
- Platform catalogue: unverified "generic media" blocks removed (Facebook, Snapchat, Reddit,
  Twitch, Kwai carry no media block), YouTube's `application/octet-stream` MIME claim dropped,
  TikTok's single-item album corrected to two and its video modelled as `shortVideo`, Instagram
  gained Reels as `shortVideo`, and every remaining media block states its transport.

- Added source-backed, versioned capability profiles for Facebook, Threads, Instagram,
  WhatsApp Channels, YouTube, Vimeo, TikTok, Mastodon, X, Bluesky, Snapchat,
  Discord, Pinterest, LinkedIn, Reddit, Twitch, Kwai, and Dailymotion.
- Added type-specific body/title/description/tag limits and source-specific media byte limits.
- Telegram capabilities now own caption and URL-upload size limits, and expose reusable local
  credential validation.
- Corrected Telegram media capabilities to match the implemented URL/file-id transport, enforced
  the Bot API's 2–10 item album size, and preserved audio/document album media types.
- Telegram albums now reject ambiguous media URLs and invalid mixed media before publishing, and
  only send spoiler fields for photo/video items.
