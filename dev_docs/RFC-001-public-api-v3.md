# RFC-001 — Public API v3

Status: **draft, awaiting approval**
Target release: `3.0.0` (breaking, no compatibility shims — see `AGENTS.md`)

## Why

The v2 surface was designed against one network (Telegram) and one transport trait (URL
pass-through). Reviewing it against the networks we intend to support — the large Western ones,
the open-source fediverse, and the regional/Asian ones — turns up four structural gaps:

1. **Byte input cannot be expressed.** `MediaInput.src` is an `http(s)` string, so every network
   that requires an upload (X, LinkedIn, Mastodon, Bluesky, VK, Weibo, Bilibili, Douyin,
   Xiaohongshu) is unreachable without the host first hosting the file publicly. The internal
   `MediaSource` already models bytes, blobs and streams; only the public type is missing.
2. **Common fields are missing** that most networks share: audience/visibility, content warning,
   media alt text, poll structure, reply target, location.
3. **Platform-specific required fields are invisible.** They go into an untyped `options` bag that
   the capability descriptor cannot describe and the validator cannot check, so a network with a
   mandatory category (Bilibili `tid`, Reddit subreddit + flair, Naver category, Zhihu column)
   fails only at the API.
4. **Result shapes are inconsistent** and lossy: `StatusResult` is not a `success` union and
   conflates "the platform rejected the post" with "we could not ask"; a publication that creates
   several platform objects (a Telegram album creates ten messages) reports one id.

## Design principle

> Fields that many networks share are **first-class and validated**. Fields specific to one
> network go into `extra`, and the network **declares them in its capability descriptor** so the
> generic validator and a host UI can still see them.

`extra` is therefore not an escape hatch from the model — it is a declared part of it.

## Scope

In scope: publishing, previewing, status checks, **deletion**, the capability model, media input,
result shapes, naming.

Out of scope for this RFC, reserved by design: **editing** (`client.edit()` /
`IPlatform.edit?()`), native **threads**, and **target discovery** (`IPlatform.listTargets?()`).
Each gets a named seam here so adding it later is additive rather than breaking.

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
  image?: MediaInput;
  video?: MediaInput;
  audio?: MediaInput;
  document?: MediaInput;
  media?: MediaInput[];
  /** Preview image for a video or an article. Never publishable content on its own. */
  thumbnail?: MediaInput;

  // — audience and moderation —
  visibility?: Visibility;
  sensitive?: boolean;
  contentWarning?: string;
  commentsEnabled?: boolean;

  // — structure —
  /** Publish as a reply/comment to an existing post. */
  inReplyTo?: string;
  /** Republish an existing post; a `body` alongside it makes it a quote. */
  repostOf?: string;
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
  maxBodyLength?: number;
}

/** Standard audiences, plus any value a platform declares. */
export type Visibility =
  | 'public' | 'unlisted' | 'followers' | 'private' | 'direct'
  | (string & {});

export interface PollInput {
  options: string[];
  durationSecs?: number;
  multiple?: boolean;
  anonymous?: boolean;
}

export interface LocationInput {
  latitude?: number;
  longitude?: number;
  name?: string;
  /** Platform-side place identifier, when the host already has one. */
  placeId?: string;
}
```

### Renames (no aliases kept)

| v2 | v3 | Reason |
| --- | --- | --- |
| `channelId` | `target` | X/Mastodon/Bluesky have no channel; Reddit has a board, LinkedIn an org URN |
| `cover` | `image` | `cover` meant both "the image of an image post" and "preview picture"; the two are now `image` and `thumbnail` |
| `disableNotification` | `silent` | Telegram vocabulary in a core type |
| `postLanguage` | `language` | Redundant prefix inside `PostRequest` |
| `maxBody` | `maxBodyLength` | Matches `capabilities.maxBodyLength` |
| `options` | `extra` | Was confusable with call options; now paired with `capabilities.extraFields` |
| `MediaInput.hasSpoiler` | `MediaInput.sensitive` | Telegram vocabulary; aligns with post-level `sensitive` |

`AccountConfig.channelId` → `AccountConfig.target`, `AccountConfig.maxBody` →
`AccountConfig.maxBodyLength` for the same reasons.

---

## 2. Media input

`MediaInput` becomes a discriminated union that mirrors the internal `MediaSource` one-to-one, so
`toMediaSource()` becomes a pass-through and `MediaInputHelper`'s URL-versus-reference guessing
disappears entirely.

```ts
export interface MediaInputBase {
  /** Overrides detection by extension; required for `platformRef` items in an album. */
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
  /** Per-item preview image (a video thumbnail inside an album). */
  thumbnail?: MediaInput;
}

export type MediaInput =
  | (MediaInputBase & { url: string })
  | (MediaInputBase & { bytes: Uint8Array })
  | (MediaInputBase & { blob: Blob })
  | (MediaInputBase & { stream: MediaStreamFactory; sizeBytes?: number })
  | (MediaInputBase & { platformRef: string });

export type MediaStreamFactory = (options?: {
  offsetBytes?: number;
  signal?: AbortSignal;
}) => Promise<ReadableStream<Uint8Array>>;
```

Consequences:

- `MAX_MEDIA_SRC_LENGTH` applies to the `url` and `platformRef` variants only.
- The generic validator rejects a `bytes`/`blob`/`stream` item for a platform whose descriptor
  says `requiresByteUpload: false && supportsUrlPassthrough: true` **and** that has no upload
  path — a clear local error instead of a confusing API failure.
- `MediaFetcher` and `runChunkedUpload` stop being experimental: they now have a public entry
  point feeding them.

### HTTP shell

JSON cannot carry bytes. The shell accepts `url`, `platformRef`, and adds
`{ base64: string }` (subject to `MAX_REQUEST_BODY_BYTES`), which it decodes into a `bytes`
source. A `multipart/form-data` publish endpoint for large files is noted as future work, not
built here.

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
  REPOST: 'repost',
} as const;

export type PostType = (typeof PostType)[keyof typeof PostType] | (string & {});
```

- **Removed:** `SHORT`. Short-form video is a property of a video (aspect ratio, duration), not a
  separate content model; it is expressed through `media.video` constraints and `extra`.
- **Added:** `REPOST` — a repost/boost/forward is a first-class publication on VK, Weibo,
  Mastodon and Telegram. Paired with `repostOf`.
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
  supportsUrlPassthrough?: boolean;
  requiresByteUpload?: boolean;
  altText?: { supported: boolean; required?: boolean; maxLength?: number };

  // audience and moderation
  supportedVisibility?: Visibility[];
  defaultVisibility?: Visibility;
  supportsContentWarning?: boolean;
  supportsSensitiveFlag?: boolean;
  supportsCommentsToggle?: boolean;

  // structure
  supportsReply?: boolean;
  supportsRepost?: boolean;
  supportsQuote?: boolean;
  poll?: {
    minOptions?: number;
    maxOptions?: number;
    maxOptionLength?: number;
    maxDurationSecs?: number;
    supportsMultiple?: boolean;
    supportsAnonymous?: boolean;
  };
  supportsLocation?: boolean;

  // delivery
  supportsNativeScheduling?: boolean;
  supportsDraft?: boolean;
  supportsIdempotencyKey?: boolean;
  supportsDeletion?: boolean;
  /** Reserved; editing lands in a later release. */
  supportsEditing?: boolean;

  // credentials, so a host can drive a connect flow without hard-coded knowledge
  auth?: {
    kind: 'apiKey' | 'oauth2' | 'custom';
    scopes?: string[];
    /** Whether a request must name a `target`. */
    requiresTarget?: boolean;
    docsUrl?: string;
  };

  /** Platform-specific fields the network requires or accepts, as data. */
  extraFields?: ExtraFieldSpec[];

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
  maxLength?: number;
  /** Human-readable label and hint, for a host that renders a form. */
  label?: string;
  description?: string;
}
```

Also:

- `supportedTypes` is **removed**; `postTypes` keys are authoritative. A type with no special
  rules is declared as `{}`. The conformance suite already asserted the two agreed.
- `PostTypeCapabilities` gains per-kind media counts and a mixing rule:
  ```ts
  export interface PostTypeCapabilities {
    requiredFields?: string[];
    forbiddenFields?: string[];
    minMediaCount?: number;
    maxMediaCount?: number;
    /** Counts per media kind inside `media[]`. */
    mediaCounts?: Partial<Record<MediaType, { min?: number; max?: number }>>;
    /** Whether one `media[]` may mix kinds (Telegram cannot mix audio with photos). */
    allowsMixedMedia?: boolean;
  }
  ```
- `MediaConstraints` gains `minWidth` / `maxWidth` / `minHeight` / `maxHeight`.
- `supportsSpoiler` → `supportsSensitiveFlag`; `supportsCoverWithMedia` → `supportsThumbnailWithMedia`.
- `rateLimits` is unchanged and stays advisory.

### What the generic validator gains

Everything above is checked in one place (`validateAgainstCapabilities`), so no platform
re-implements it:

- `visibility` not in `supportedVisibility` → error naming the accepted values;
- `contentWarning` / `sensitive` / `commentsEnabled` / `location` / `poll` / `inReplyTo` /
  `repostOf` / `idempotencyKey` against their `supports*` flags → error, not a silent drop;
- poll option count, option length and duration against `capabilities.poll`;
- `title` / `description` / tag count / tag length against the platform's own limits, replacing
  the core-wide constants;
- `altText` required-but-missing, and over-length;
- media kind counts and mixing inside `media[]`;
- pixel dimensions where declared;
- byte-input given to a platform with no upload path;
- **`extra`**: unknown key → warning; declared-required key missing → error; wrong type or a value
  outside `values` → error.

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
  parts?: Array<{ id: string; url?: string; type?: MediaType }>;
  handle?: ResumeHandle;
  checkAfterMs?: number;
  platform: string;
  type: PostType;
  publishedAt: string;
  raw?: Record<string, unknown>;
  requestId: string;
}
```

A Telegram album currently discards nine of ten `message_id`s
(`packages/platform-telegram/src/telegram.platform.ts:216`); `parts` is also what makes the new
`delete()` able to remove the whole publication.

### `StatusResult` becomes a `success` union

```ts
export type StatusResult =
  | { success: true; data: { status: 'published' | 'processing' | 'failed'; postId?: string;
        url?: string; parts?: PostPart[]; checkAfterMs?: number;
        /** Why the platform rejected it, when status is 'failed'. */
        reason?: ErrorPayload; raw?: Record<string, unknown> } }
  | { success: false; error: ErrorPayload };
```

`failed` now means only "the platform rejected the post". A timeout while asking becomes
`success: false`, so a host following `docs/DELIVERY-SEMANTICS.md` stops dead-lettering posts
that are actually fine (`packages/core/src/services/post.service.ts:162`).

### `PreviewResult` gets the same discipline

```ts
export type PreviewResult =
  | { success: true; data: {
        valid: boolean;               // whether it could be published
        detectedType: PostType;
        issues: Issue[];              // blocking, when valid is false
        warnings: Issue[];
        ignoredFields: string[];      // computed today and thrown away
        convertedBody?: string;
        convertedBodyLength?: number;
        targetFormat: string;
        truncated?: boolean;          // conversion overflowed the limit
      } }
  | { success: false; error: ErrorPayload };  // preview itself could not run
```

`success` now means the same thing in `post()`, `preview()`, `checkStatus()` and `delete()`.
`capability-preview.ts:26` stops discarding `ignoredFields`, and a silent truncation after
`md → html` expansion becomes a reported fact.

---

## 6. Deletion

```ts
export interface PostRef {
  /** The id `post()` returned. */
  postId: string;
  /** Every part, for a publication that created more than one object. */
  parts?: string[];
  /** Where it lives, when the platform needs it to address the post. */
  target?: string | number;
}

// client
delete(
  request: Pick<PostRequest, 'platform' | 'account' | 'auth' | 'target'>,
  ref: PostRef,
  options?: { signal?: AbortSignal },
): Promise<DeleteResult>;

// IPlatform
delete?(ref: PostRef, accountConfig: ResolvedAccountConfig, signal?: AbortSignal): Promise<DeleteOutcome>;
```

- `DeleteResult` is a `success` union like the rest.
- Deleting something already gone is **success** (`data.alreadyGone: true`), not an error —
  compensating logic in a host must be safely repeatable.
- New `ErrorCode.NOT_FOUND` for a reference the platform does not recognize.
- A platform without `delete` yields `VALIDATION_ERROR`, mirroring `checkStatus`.
- Declared in the descriptor as `supportsDeletion`.
- HTTP shell: `POST /api/v1/delete` (the reference is composite, so not `DELETE /post/:id`).

**Rationale:** the motivating case is a multi-network publication where three of five networks
accepted and the fourth failed permanently. Without deletion the host must build a second,
parallel integration layer just to roll back.

### Reserved for a later release

`client.edit()` and `IPlatform.edit?()` with `supportsEditing` already in the descriptor; adding
them will be additive. Same for `IPlatform.listTargets?()` (pages, channels, boards) and native
threads (`PostRequest.thread?: ThreadItem[]`, resumable across items via the existing
`ResumeHandle`).

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

Renames from §1, `PostType`/`BodyFormat` as open const objects, `SHORT` removed, `REPOST` added.
No behaviour change. Largest diff, lowest risk — land it first and alone.

### Phase 2 — Capability descriptor v2

`platforms/capabilities.ts`, `validation/capability-validator.ts`, `validation/validate-post-request.ts`.

New descriptor fields, `postTypes` becomes authoritative, per-kind media counts, `extraFields`
plus its validator. Telegram's descriptor is rewritten against it. Conformance gains: a declared
`extraFields` entry must be exercised by a sample request; a descriptor must state `auth.kind`.

### Phase 3 — Media input union

`types/media-input.ts`, `media/media-source.ts`, `media/media-input.helper.ts`,
`media/media-priority.ts`, `validation/*`, the Telegram media mapper, and the HTTP shell's
`base64` decoding.

Unlocks byte upload end to end; `MediaFetcher` / `runChunkedUpload` lose their "experimental"
caveat in `packages/core/README.md`.

### Phase 4 — Content model

`visibility`, `sensitive`, `contentWarning`, `commentsEnabled`, `altText`, `poll`, `location`,
`inReplyTo`, `repostOf`, `idempotencyKey`, `thumbnail`, and their validation against Phase 2's
flags. Telegram implements what it has (`sensitive` → spoiler, `inReplyTo` →
`reply_to_message_id`, `poll` → `sendPoll`, `repostOf` → `forwardMessage`, `silent`, `location` →
`sendVenue`/`sendLocation`) and declares the rest unsupported.

### Phase 5 — Result shapes

`Issue`, `parts`, `StatusResult` and `PreviewResult` as `success` unions, `ignoredFields` and
`truncated` surfaced, `ErrorCode.NOT_FOUND` added. HTTP shell response docs updated. Telegram
returns every album `message_id` in `parts`.

### Phase 6 — Deletion

`PostRef`, `client.delete()`, `IPlatform.delete?()`, `supportsDeletion`, `POST /api/v1/delete`,
Telegram `deleteMessage` (including every part of an album), conformance cases for
delete-twice and delete-unknown-id.

### Phase 7 — Packaging and documentation

Subpath export split, `PlatformDeps.fetch`, dead-code removal, and a full pass over `README.md`,
`packages/core/README.md`, `CONTRIBUTING-PLATFORMS.md`, `apps/server/README.md`,
`docs/DELIVERY-SEMANTICS.md`, `docs/OAUTH.md` and `docs/CHANGELOG.md`, plus a `3.0.0` migration
note.

---

## Open questions

1. **`base64` media over HTTP** — accept it (capped by `MAX_REQUEST_BODY_BYTES`), or refuse byte
   input at the HTTP boundary entirely and require a URL there?
2. **`extra` typing for TypeScript hosts** — leave it `Record<string, unknown>`, or make
   `PostRequest` generic (`PostRequest<TExtra>`) so an adapter package can export a typed request?
   Generics cost readability everywhere the type appears.
3. **`repostOf` as a type or a field** — keep both (`PostType.REPOST` + `repostOf`), or drop the
   type and let the field alone imply it, the way `inReplyTo` does?
4. **`mode: 'publish' | 'draft'`** — keep as is, or fold into a single `status` field alongside
   `scheduledAt`?
5. **Rollout** — one `3.0.0` after all seven phases, or ship `3.0.0-rc.N` per phase? The
   library has one adapter and no external consumers yet, which argues for the former.
