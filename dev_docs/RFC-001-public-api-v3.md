# RFC-001 — Public API v3

Status: **draft, awaiting approval**
Target release: `3.0.0` (breaking, no compatibility shims — see `AGENTS.md`)

## Why

The v2 API was designed around Telegram and URL pass-through. It cannot express byte uploads,
common publication fields, declared platform-specific requirements, or multi-object results.
v3 makes these capabilities explicit while keeping the core library stateless between calls.

## Design principle

> Fields that many networks share are **first-class and validated**. Fields specific to one
> network go into `extra`, and the network **declares them in its capability descriptor** so the
> generic validator and a host UI can still see them.

`extra` is therefore not an escape hatch from the model — it is a declared part of it.

- The core never retains durable state between calls. A host owns retries, scheduling,
  idempotency records, OAuth callback state, and resumable-operation handles.
- State held only while one `post()`, `checkStatus()`, or `delete()` call runs is allowed.
- A capability descriptor is a reliable declaration of simple, static constraints. It is not an
  attempt to model every vendor API or generate a complete OAuth UI.

## Scope

In scope: publishing, previewing, status checks, **deletion**, the capability model, media input,
result shapes, naming.

Out of scope: editing, native threads, target discovery, multipart HTTP uploads, and a universal
OAuth connect flow. They will be designed independently; no speculative public flags are added
for them in this RFC.

---

## 1. The request

```ts
export interface PostRequest {
  // — routing —
  platform: string;
  account?: string;
  auth?: Record<string, unknown>;
  /** Where on the platform to publish: channel, page, board, community, profile. */
  target?: string | number;

  // — content —
  body?: string;
  bodyFormat?: string;
  type?: PostType;
  title?: string;
  description?: string;
  tags?: string[];
  language?: string;

  // — media —
  /** The only publishable media collection. Its order is preserved. */
  media?: MediaInput[];
  /** Preview image for a video or an article. Never publishable content on its own. */
  thumbnail?: ThumbnailInput;

  // — audience and moderation —
  visibility?: Visibility;
  sensitive?: boolean;
  contentWarning?: string;
  commentsEnabled?: boolean;

  // — structure —
  /** Publish as a reply/comment to an existing post. */
  inReplyTo?: PlatformObjectRef;
  /** Republish an existing post; a `body` alongside it makes it a quote. */
  repostOf?: PlatformObjectRef;
  poll?: PollInput;
  location?: LocationInput;

  // — delivery —
  scheduledAt?: string;
  mode?: 'publish' | 'draft';
  silent?: boolean;
  /** Passed to networks that deduplicate on it (Mastodon `Idempotency-Key`). */
  idempotencyKey?: string;

  // — escape hatch, declared by the platform —
  extra?: Record<string, unknown>;
}

/** Standard audiences, plus any value a platform declares. */
export type Visibility = 'public' | 'unlisted' | 'followers' | 'private' | 'direct' | (string & {});

export interface PlatformObjectRef {
  /** Platform-native object identifier. */
  id: string;
  /** Source channel/community when an id alone is not globally addressable. */
  target?: string | number;
  /** Adapter-defined addressing data, e.g. a Telegram source chat id. */
  extra?: Record<string, JsonValue>;
}

export interface PollInput {
  options: string[];
  durationSecs?: number;
  multiple?: boolean;
  anonymous?: boolean;
}

/** Exactly one of coordinates or placeId is required. Coordinates are supplied as a pair. */
export type LocationInput =
  | { latitude: number; longitude: number; name?: string; placeId?: never }
  | { placeId: string; name?: string; latitude?: never; longitude?: never };
```

`type` is a requested or detected content type, not an independent second content model. The
validator rejects combinations not declared by `postTypes`: for example poll plus media, a
thumbnail without a compatible video/article type, a repost without `repostOf`, or a reply where
the type forbids it. `repostOf` implies the detected `repost` type when `type` is omitted.

### Renames (no aliases kept)

| v2                      | v3                     | Reason                                                                       |
| ----------------------- | ---------------------- | ---------------------------------------------------------------------------- |
| `channelId`             | `target`               | X/Mastodon/Bluesky have no channel; Reddit has a board, LinkedIn an org URN  |
| `cover`                 | `thumbnail`            | A preview asset is distinct from publishable media.                          |
| `disableNotification`   | `silent`               | Telegram vocabulary in a core type                                           |
| `postLanguage`          | `language`             | Redundant prefix inside `PostRequest`                                        |
| `maxBody`               | `maxBodyLength`        | Matches `capabilities.maxBodyLength`                                         |
| `options`               | `extra`                | Was confusable with call options; now paired with `capabilities.extraFields` |
| `MediaInput.hasSpoiler` | `MediaInput.sensitive` | Telegram vocabulary; aligns with post-level `sensitive`                      |

`AccountConfig.channelId` → `AccountConfig.target`, `AccountConfig.maxBody` →
`AccountConfig.maxBodyLength` for the same reasons. `maxBodyLength` is removed from
`PostRequest`: an account value can only clamp a platform limit, never raise it.

---

## 2. Media input

`MediaInput` is strictly discriminated. The source is nested to prevent an object from
accidentally containing both a URL and bytes. `toMediaSource()` becomes a direct conversion and
URL-versus-reference guessing disappears.

```ts
export interface MediaInput {
  /** Required whenever the type cannot be safely detected from the source. */
  type?: MediaType;
  /** Accessibility description. Mastodon, Bluesky, X and LinkedIn all take one. */
  altText?: string;
  /** Hide behind a blur/spoiler where the network supports it. */
  sensitive?: boolean;
  fileName?: string;
  mimeType?: string;
  durationSecs?: number;
  width?: number;
  height?: number;
  thumbnail?: ThumbnailInput;
  source: MediaSourceInput;
}

/** A thumbnail cannot recursively contain another thumbnail. */
export type ThumbnailInput = Omit<MediaInput, 'thumbnail' | 'type'> & { type?: 'image' };

export type MediaSourceInput =
  | { kind: 'url'; url: string }
  | { kind: 'bytes'; bytes: Uint8Array }
  | { kind: 'blob'; blob: Blob }
  | { kind: 'stream'; open: MediaStreamFactory; sizeBytes?: number }
  | { kind: 'platformRef'; ref: string };

export type MediaStreamFactory = (options?: {
  /** When supplied, the returned stream must begin exactly at this byte offset. */
  offsetBytes?: number;
  signal?: AbortSignal;
}) => Promise<ReadableStream<Uint8Array>>;
```

`MediaStreamFactory` is replayable by contract. An adapter may resume a chunked upload only when
the source honours `offsetBytes`; otherwise it returns a non-resumable error instead of silently
re-uploading from the beginning. Streams, blobs and bytes are held only during the call.

### HTTP shell

JSON cannot carry bytes. The shell accepts `url`, `platformRef`, and a shell-only source
`{ kind: 'base64', base64: string }`. It validates encoded and decoded size before converting to
`{ kind: 'bytes', bytes }`; `base64` is never a library type. Base64 is for small files only:
the encoded value costs roughly one third more bytes and decoding needs memory. Large files need a
public URL until a separately designed multipart endpoint lands.

---

## 3. Post types

`PostType` becomes a const object plus an open union, so a regional network can declare a type the
core has never heard of. Call sites (`PostType.POST`) are unchanged.

```ts
export const PostType = {
  AUTO: 'auto',
  POST: 'post',
  ARTICLE: 'article',
  IMAGE: 'image',
  ALBUM: 'album',
  VIDEO: 'video',
  AUDIO: 'audio',
  DOCUMENT: 'document',
  STORY: 'story',
  POLL: 'poll',
} as const;

export type PostType = (typeof PostType)[keyof typeof PostType] | (string & {});
```

- **Removed:** `SHORT`. Short-form video is constrained by media dimensions and duration, not a
  separate content model.
- **Removed:** `REPOST`. A repost is expressed by `repostOf`, just as a reply is expressed by
  `inReplyTo`; this avoids two contradictory sources of truth.
- `POLL` and `STORY` stay only because §1 now gives them fields to carry.

`BodyFormat` gets the same const-object treatment for symmetry (`bodyFormat` is already an open
string in the request).

---

## 4. The capability descriptor

```ts
export interface PlatformCapabilities {
  name: string;
  displayName?: string;

  /** Per-type rules. Its keys are the definitive list of publishable types. */
  postTypes: Partial<Record<PostType, PostTypeCapabilities>>;

  // body
  maxBodyLength?: number;
  bodyLengthRule?: BodyLengthRule;
  supportedBodyFormats?: string[];
  targetBodyFormat?: string;
  passthroughBodyFormats?: string[];

  // text fields
  maxTitleLength?: number;
  maxDescriptionLength?: number;
  maxTags?: number;
  maxTagLength?: number;
  tagFormat?: 'plain' | 'hashtag';

  // media
  media?: Partial<Record<MediaType, MediaConstraints>>;
  altText?: { supported: boolean; required?: boolean; maxLength?: number };
  thumbnail?: { supported: boolean; maxBytes?: number };

  // audience and moderation
  supportedVisibility?: Visibility[];
  defaultVisibility?: Visibility;
  supportsContentWarning?: boolean;
  sensitive?: ToggleCapabilities;
  commentsEnabled?: ToggleCapabilities;

  // structure
  supportsReply?: boolean;
  supportsRepost?: boolean;
  supportsQuote?: boolean;
  poll?: {
    minOptions?: number;
    maxOptions?: number;
    maxOptionLength?: number;
    minDurationSecs?: number;
    maxDurationSecs?: number;
    multiple?: ToggleCapabilities;
    anonymous?: ToggleCapabilities;
  };
  location?: { supportsCoordinates?: boolean; supportsPlaceId?: boolean; requiresName?: boolean };

  // delivery
  supportsNativeScheduling?: boolean;
  minScheduleLeadSecs?: number;
  maxScheduleAheadSecs?: number;
  supportsDraft?: boolean;
  supportsIdempotencyKey?: boolean;
  supportsDeletion?: boolean;

  // Hints for documentation/configuration, not a complete OAuth flow contract.
  auth?: {
    kind: 'apiKey' | 'oauth2' | 'custom';
    scopes?: string[];
    /** Whether a request must name a `target`. */
    requiresTarget?: boolean;
    docsUrl?: string;
  };

  /** Platform-specific fields the network requires or accepts, as data. */
  extraFields?: ExtraFieldSpec[];
  /** False by default: unknown `extra` keys are validation errors. */
  allowUnknownExtraFields?: boolean;

  ignoredFields?: string[];
  rateLimits?: RateLimits;
}

export interface ExtraFieldSpec {
  /** Key inside `request.extra`. */
  name: string;
  type: 'string' | 'number' | 'boolean' | 'enum' | 'string[]';
  required?: boolean;
  /** Restrict the requirement to certain post types. */
  forTypes?: PostType[];
  values?: Array<string | number>;
  min?: number;
  max?: number;
  minItems?: number;
  maxItems?: number;
  pattern?: string;
  maxLength?: number;
  /** Human-readable label and hint, for a host that renders a form. */
  label?: string;
  description?: string;
}

export interface ToggleCapabilities {
  /** Values a caller may select; omitted means the field is unsupported. */
  supportedValues: boolean[];
  default?: boolean;
}
```

Also:

- `supportedTypes` is **removed**; `postTypes` keys are authoritative. A type with no special
  rules is declared as `{}`. The conformance suite already asserted the two agreed.
- `PostTypeCapabilities` gains per-kind media counts and a mixing rule:
  ```ts
  export interface PostTypeCapabilities {
    requiredFields?: RequestField[];
    forbiddenFields?: RequestField[];
    minMediaCount?: number;
    maxMediaCount?: number;
    /** Counts per media kind inside `media[]`. */
    mediaCounts?: Partial<Record<MediaType, { min?: number; max?: number }>>;
    /** Whether one `media[]` may mix kinds (Telegram cannot mix audio with photos). */
    allowsMixedMedia?: boolean;
  }
  ```

```ts
export interface MediaConstraints {
  /** At least one source kind is required for each declared media type. */
  acceptedSources: MediaSourceInput['kind'][];
  mimeTypes?: string[];
  maxBytes?: number;
  minDurationSecs?: number;
  maxDurationSecs?: number;
  minAspectRatio?: number;
  maxAspectRatio?: number;
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
}
```

- `MediaConstraints` gains `acceptedSources`, `minWidth` / `maxWidth` / `minHeight` /
  `maxHeight`. Source kinds include `'url'`, `'bytes'`, `'blob'`, `'stream'`, and
  `'platformRef'`.
- `supportedTypes`, `supportsUrlPassthrough`, `requiresByteUpload`, `supportsSpoiler`, and
  `supportsCoverWithMedia` are removed. Source support belongs to each media kind, not globally.
- `rateLimits` is unchanged and stays advisory.

```ts
export type RequestField =
  | 'body'
  | 'title'
  | 'description'
  | 'tags'
  | 'media'
  | 'thumbnail'
  | 'visibility'
  | 'contentWarning'
  | 'sensitive'
  | 'commentsEnabled'
  | 'inReplyTo'
  | 'repostOf'
  | 'poll'
  | 'location'
  | 'scheduledAt'
  | 'mode';
```

`RequestField` is deliberately closed: descriptors cannot use unchecked arbitrary dotted paths.
`extraFields` describes simple static scalar and string-array fields only. Conditional
requirements, nested values, target-dependent values and discovery remain in
`IPlatform.validateExtra()`, which returns structured `Issue[]`. The descriptor can help a basic
host UI, but does not promise to render every vendor form.

`validateCapabilities()` runs when a module is registered and in conformance. It rejects empty
source lists, contradictory limits/defaults, unknown field names, inconsistent post-type rules,
and a `supportsDeletion`/`delete` mismatch.

### What the generic validator gains

Everything above is checked in one place (`validateAgainstCapabilities`), so no platform
re-implements it:

- `visibility` not in `supportedVisibility` → error naming the accepted values;
- `contentWarning`, toggles, location, poll, reply, repost, thumbnail and idempotency key against
  their declared support → error, not a silent drop;
- poll option count, option length and duration against `capabilities.poll`;
- `title` / `description` / tag count / tag length against the platform's own limits, replacing
  the core-wide constants;
- `altText` required-but-missing, and over-length;
- media kind counts and mixing inside `media[]`;
- each media source against its media kind's `acceptedSources`, plus declared pixel dimensions;
- **`extra`**: unknown key → error unless `allowUnknownExtraFields`; declared-required key missing,
  wrong type, out-of-range or invalid enum/pattern → error.

The validator checks caller-declared `mimeType`, dimensions and duration; it does not claim to
inspect the actual remote file. Media inspection would add network, cost and SSRF concerns and is
not part of preview.

`MAX_TITLE_LENGTH`, `MAX_DESCRIPTION_LENGTH`, `MAX_TAGS`, `MAX_TAG_LENGTH` remain in
`validate-post-request.ts` only as absolute structural sanity bounds; the meaningful limits move
to the descriptor.

---

## 5. Results

### Structured issues everywhere

```ts
export interface Issue {
  /** Stable machine code, e.g. 'BODY_TOO_LONG', 'FIELD_REQUIRED', 'FIELD_UNSUPPORTED'. */
  code: string;
  /** Request path the issue is about, e.g. 'media[2].altText'. */
  field?: string;
  /** English message; hosts localize from `code` + `params`. */
  message: string;
  params?: Record<string, JsonValue>;
}
```

`string[]` errors/warnings are replaced by `Issue[]` in the preview result and in
`ValidationError.issues` (surfaced through `error.details.issues`). This is what makes a
non-English host UI possible at all.

### `PostResponse`

```ts
data: {
  status: 'published' | 'processing';
  postId?: string;              // the canonical/primary id
  url?: string;
  /** Every platform object this publication created, when it created more than one. */
  parts?: PostPart[];
  /** Canonical value to persist for deletion and future editing. */
  ref: PostRef;
  handle?: ResumeHandle;
  checkAfterMs?: number;
  platform: string;
  type: PostType;
  publishedAt: string;
  raw?: JsonValue;
  requestId: string;
}
```

```ts
export interface PostPart {
  id: string;
  target?: string | number;
  url?: string;
  /** Adapter-defined kind; it need not be a media type. */
  kind?: string;
}

export interface PostRef {
  postId?: string;
  target?: string | number;
  parts?: PostPart[];
  extra?: Record<string, JsonValue>;
}
```

A Telegram album returns every `message_id` in `parts` and `ref.parts`. `PostRef` may contain only
parts while a publication is processing; callers persist it rather than reconstructing addressing.

### `StatusResult` becomes a `success` union

```ts
export type StatusResult =
  | {
      success: true;
      data: {
        status: 'published' | 'processing' | 'failed';
        postId?: string;
        url?: string;
        ref?: PostRef;
        checkAfterMs?: number;
        /** Why the platform rejected it, when status is 'failed'. */
        reason?: ErrorPayload;
        raw?: JsonValue;
      };
    }
  | { success: false; error: ErrorPayload };
```

`failed` now means only "the platform rejected the post". A timeout while asking becomes
`success: false`, so a host following `docs/DELIVERY-SEMANTICS.md` stops dead-lettering posts
that are actually fine (`packages/core/src/services/post.service.ts:162`).

### `PreviewResult` gets the same discipline

```ts
export type PreviewResult =
  | {
      success: true;
      data: {
        valid: boolean; // whether it could be published
        detectedType: PostType;
        issues: Issue[]; // blocking, when valid is false
        warnings: Issue[];
        ignoredFields: RequestField[]; // computed today and thrown away
        convertedBody?: string;
        convertedBodyLength?: number;
        targetFormat?: string;
        truncated?: boolean; // conversion overflowed the limit
      };
    }
  | { success: false; error: ErrorPayload }; // preview itself could not run
```

`success` now means the same thing in `post()`, `preview()`, `checkStatus()` and `delete()`.
`capability-preview.ts:26` stops discarding `ignoredFields`, and a silent truncation after
`md → html` expansion becomes a reported fact.

---

## 6. Deletion

```ts
export interface DeletePartResult {
  id: string;
  status: 'deleted' | 'alreadyGone' | 'failed' | 'unknown';
  error?: ErrorPayload;
}

export type DeleteResult =
  | { success: true; data: {
      status: 'deleted' | 'partial';
      parts: DeletePartResult[];
      /** Present when deletion can continue without repeating completed parts. */
      handle?: ResumeHandle;
    } }
  | { success: false; error: ErrorPayload };

// client
delete(
  request: Pick<PostRequest, 'platform' | 'account' | 'auth' | 'target'>,
  ref: PostRef,
  options?: { signal?: AbortSignal; resume?: ResumeHandle },
): Promise<DeleteResult>;

// IPlatform
delete?(
  ref: PostRef,
  accountConfig: ResolvedAccountConfig,
  options?: { signal?: AbortSignal; resume?: ResumeHandle },
): Promise<DeleteOutcome>;
```

- `DeleteResult` is a `success` union like the rest. Deletion is best-effort and never falsely
  atomic: each part is reported as deleted, unambiguously already absent, failed, or unknown.
- An unambiguously absent part is an idempotent successful outcome. An ambiguous vendor error is
  never silently treated as already gone.
- A partial delete returns the completed per-part results and a resume handle when resumption is
  possible. The host persists that handle before retrying.
- `ErrorCode.NOT_FOUND` is reserved for a reference the platform unambiguously says never existed
  or cannot address; it is not used for an already-absent known part.
- A platform without `delete` yields `VALIDATION_ERROR`; its method and `supportsDeletion` must
  agree, checked by conformance.
- HTTP shell: `POST /api/v1/delete` (the reference is composite, so not `DELETE /post/:id`).

**Rationale:** the motivating case is a multi-network publication where three of five networks
accepted and the fourth failed permanently. Without deletion the host must build a second,
parallel integration layer just to roll back.

### Reserved for a later release

`client.edit()`, `IPlatform.listTargets?()` and native threads are intentionally absent. Their
reference, partial-result and state semantics will be designed when their APIs are introduced.

---

## 7. Packaging and extension seams

- **Split the entry point.** `packages/core/package.json#exports` gains `./platform`:
  - `@bozonx/social-posting` — `createPostingClient`, request/result types, `PostType`,
    `ErrorCode`, errors, `PlatformCapabilities` (read-only use), `CredentialProvider`.
  - `@bozonx/social-posting/platform` — `IPlatform`, `PlatformModule`, `PlatformError`,
    `httpRequest`, `MediaFetcher`, `runChunkedUpload`, `OAuth2TokenRefresher`, body helpers,
    `validateAgainstCapabilities`, `previewFromCapabilities`, the registries and services.

  Today one entry point exports ~60 symbols, most of which only an adapter author needs, and every
  internal helper is semver-bound to the host API.

- **`PlatformDeps` gains `fetch?: typeof fetch`** so an adapter can be pointed at a regional
  endpoint or a proxy, and so the conformance harness can inject a transport without patching
  globals.
- `MediaInputHelper` shrinks to type guards; `getUrl` / `getPlatformRef` / `getHasSpoiler`
  disappear with the discriminated union.
- `validateMediaUrls()` (the plural wrapper) is removed — unused.

---

## Work plan

Each phase is one PR, ends green on `pnpm validate:all`, and updates the Telegram adapter (the
only implementation) plus `docs/CHANGELOG.md` in the same change.

### Phase 1 — Naming and type foundation

`types/post-request.ts`, `types/post-type.ts`, `types/body-format.ts`, `types/account-config.ts`,
`config/posting-config.ts`, plus every call site and the HTTP shell's request parsing.

Renames from §1, `PostType`/`BodyFormat` as open const objects, `SHORT`/`REPOST` removed,
`PlatformObjectRef`, the single `media[]` model, strict media source union, location union and
removal of request-level `maxBodyLength`. This intentionally changes validation semantics; add
rejection tests for ambiguous media/content combinations.

### Phase 2 — Capability descriptor v2

`platforms/capabilities.ts`, `validation/capability-validator.ts`, `validation/validate-post-request.ts`.

New descriptor fields, per-kind accepted sources, closed `RequestField`, toggle/scheduling/location
constraints, `extraFields`, `validateCapabilities()`, and structured issues. Telegram's descriptor
is rewritten against it. Conformance exercises descriptor consistency and a declared `extraFields`
entry.

### Phase 3 — Media input union

`types/media-input.ts`, `media/media-source.ts`, `media/media-input.helper.ts`,
`media/media-priority.ts`, `validation/*`, the Telegram media mapper, and the HTTP shell's
`base64` decoding.

Unlocks byte upload end to end, includes capped shell-only base64 decoding, and documents that
metadata validation is declarative rather than file inspection. `MediaFetcher` /
`runChunkedUpload` lose their experimental caveat.

### Phase 4 — Content model

`visibility`, `sensitive`, `contentWarning`, `commentsEnabled`, `altText`, `poll`, `location`,
`inReplyTo`, `repostOf`, `idempotencyKey`, `thumbnail`, and their validation against Phase 2's
flags. Telegram implements what it has (`sensitive` → spoiler, `inReplyTo` →
`reply_to_message_id`, `poll` → `sendPoll`, `repostOf` → `forwardMessage`, `silent`, `location` →
`sendVenue`/`sendLocation`) and declares the rest unsupported.

### Phase 5 — Result shapes

`Issue`, `PostPart`, `PostRef`, success-union `StatusResult` and `PreviewResult`, `raw: JsonValue`,
`ignoredFields` and reported truncation. HTTP shell response docs are updated. Telegram returns
every album `message_id` in `parts` and `ref.parts`.

### Phase 6 — Deletion

`client.delete()`, `IPlatform.delete?()`, per-part outcomes, non-atomic/resume semantics,
`POST /api/v1/delete`, Telegram `deleteMessage` (including every album part), and conformance
cases for partial failure, retry, absent and unknown references.

### Phase 7 — Packaging and documentation

Subpath export split, `PlatformDeps.fetch`, dead-code removal, and a full pass over `README.md`,
`packages/core/README.md`, `CONTRIBUTING-PLATFORMS.md`, `apps/server/README.md`,
`docs/DELIVERY-SEMANTICS.md`, `docs/OAUTH.md` and `docs/CHANGELOG.md`, plus a `3.0.0` migration
note.

---

## Decided design choices

1. **Base64 media over HTTP** — accept capped base64 for small files only; large files require a
   URL until multipart is designed separately.
2. **`extra` typing for TypeScript hosts** — keep `PostRequest` non-generic. An adapter may export
   `PostRequest & { extra?: TelegramExtra }` without spreading generics through the core API.
3. **`repostOf`** — keep the field and remove a separate core `PostType.REPOST`.
4. **`mode`** — keep it separate from result status and `scheduledAt`.
5. **Rollout** — publish one coherent `3.0.0`, preceded by RCs only after all phases are complete.

---

## Cross-request state: unavoidable cases and owner

The core library never stores these values. It may create or consume them within a request, but a
host must persist them if work continues after the call returns.

| Case                                    | Why it crosses requests                                                   | Owner                                                      | Core behaviour                                                                 |
| --------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Retry after an uncertain publish result | A sent mutation may have succeeded despite a lost response.               | Host job record/idempotency store.                         | Returns classification and any `ResumeHandle`; never retries mutations itself. |
| Resumable multi-step upload/publish     | Upload/container progress must survive a failed call.                     | Host job record.                                           | Emits/accepts JSON-serializable `ResumeHandle`.                                |
| Deferred processing status checks       | Polling later requires a scheduler and durable job.                       | Host scheduler/job record.                                 | Returns a handle and `checkAfterMs`; never polls.                              |
| Partial deletion retry                  | Some parts may be deleted before another part fails or becomes unknown.   | Host job record.                                           | Returns per-part outcomes and a resumable handle when available.               |
| OAuth redirect callback                 | OAuth `state`, nonce and PKCE verifier must survive browser redirect.     | Host session/store.                                        | Provides auth hints and token-refresh helpers only; no universal connect flow. |
| Application-level deduplication         | Only the caller knows whether two business jobs are the same publication. | Host database/idempotency store.                           | Forwards an idempotency key only where the platform supports it.               |
| Native scheduled post lifecycle         | A platform may materialize or reject a scheduled post later.              | Platform; host stores its `PostRef` if it needs follow-up. | Makes one API call and returns the platform result.                            |
