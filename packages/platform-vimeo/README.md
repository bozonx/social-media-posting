# @bozonx/social-posting-vimeo

Vimeo support for [`@bozonx/social-posting`](https://www.npmjs.com/package/@bozonx/social-posting).
Zero runtime dependencies, Web APIs only — it runs on Node, Bun, Deno and Cloudflare Workers.

```bash
pnpm add @bozonx/social-posting @bozonx/social-posting-vimeo
```

```ts
import { createPostingClient } from '@bozonx/social-posting';
import { vimeo } from '@bozonx/social-posting-vimeo';

const client = createPostingClient({
  platforms: [vimeo],
  accounts: {
    studio: { platform: 'vimeo', auth: { accessToken: process.env.VIMEO_TOKEN } },
  },
});

const result = await client.post({
  platform: 'vimeo',
  account: 'studio',
  type: 'video',
  title: 'Release notes, August',
  body: 'Everything that shipped this month.',
  media: [{ type: 'video', source: { kind: 'stream', open: openFile, sizeBytes: 812_000_000 } }],
});

// result.data.status === 'processing' — see below.
```

## An uploaded video is not a playable video

`publish()` **never** returns `published`. Vimeo stores the file, then transcodes it, and only then
can anybody watch it. So `post()` answers `processing` with a handle, and the host polls
`checkStatus()` until it says otherwise.

`checkStatus()` reads `transcode.status`, not the video's `status` field: a video reads `available`
while its highest-quality rendition is still being produced.

Budget the wait from `capabilities.asyncProcessing` (`maxWaitSecs`, `pollIntervalSecs`) rather than
from a constant of your own.

## Two upload approaches

|                         | `tus` (default)              | `pull`                              |
| ----------------------- | ---------------------------- | ----------------------------------- |
| Who moves the bytes     | This process, chunk by chunk | Vimeo, from a URL you give it       |
| Resumable               | Yes                          | No                                  |
| Needs the size up front | Yes                          | No                                  |
| Your bandwidth          | Full file                    | None                                |
| A broken link surfaces  | Immediately                  | Minutes later, as a transcode error |

Choose per request with `extra.uploadApproach`, or per account with `defaultUploadApproach`.

**If you use `pull`, the URL must stay alive.** The descriptor states
`urlMustRemainAvailableForSecs: 86400` for exactly this reason: Vimeo fetches the file
asynchronously, after the create call has already returned success, and a signed link that expires
with the request produces a failure with nothing in the response to explain it.

## Storage, not operations

Vimeo's limit is the account's **stored bytes** plus a **weekly upload allowance**, both set by the
plan. Neither resets on a daily clock.

`getQuota()` reports it in bytes, and returns whichever of the two is tighter — a plan with room
left can still be out of its weekly allowance, and that is what will actually stop the next upload:

```ts
const quota = await client.getQuota({ platform: 'vimeo', account: 'studio' });
// { unit: 'bytes', remaining: 4294967296, limit: 5368709120, resetsAt: '2026-09-06T…' }
```

Exhaustion arrives as `QUOTA_EXCEEDED` with `retryable: false`: storage does not free itself, and
the right message to the user is "delete something or upgrade", not "try again tomorrow". That is
the opposite of YouTube, where the same code means exactly "try again tomorrow" —
`capabilities.rateLimits.quotaCost.unit` (`bytes` against `quotaUnits`) is what distinguishes them.

## Resumable upload

The `tus` approach uploads by offset, and a failure carries a `resumeHandle`:

```ts
const result = await client.post(request, { resume: previousError.resumeHandle });
```

The handle names **only the video**, never the tus upload link. That link is a bearer URL — anyone
holding it can write bytes into the video — and a handle is something the host writes to its
database. On resume the adapter re-reads the link from `GET /videos/{id}` and asks the tus endpoint
for its real offset, because the stored offset is only what was true before the process died.

If the session is gone by then (the upload completed, or the video was removed), the adapter raises
`UNKNOWN_OUTCOME` rather than starting a second upload.

## What it publishes

| Field                  | Maps to                                                 |
| ---------------------- | ------------------------------------------------------- |
| `title`                | `name` (≤ 128)                                          |
| `body` / `description` | `description` (≤ 5000)                                  |
| `tags`                 | `tags[]` (≤ 20)                                         |
| `visibility`           | `privacy.view` — `public`→`anybody`, `private`→`nobody` |
| `extra.privacyView`    | `privacy.view` directly, for modes `visibility` lacks   |
| `extra.folderUri`      | `folder_uri`                                            |

Setting both `visibility` and `extra.privacyView` is refused: they write the same field, and
letting one win silently publishes at a visibility nobody asked for.

## Known limits

- Vimeo publishes videos only. No text posts, no images, no galleries, no stories — and no Shorts
  equivalent, so a vertical video is an ordinary upload and `shortVideo` is absent rather than
  aliased.
- Upload access depends on the account plan; a plan that forbids it answers `403` as `AUTH_ERROR`,
  which no scope change fixes.
- `delete()` is not implemented in this iteration, and `supportsDeletion` says so.
