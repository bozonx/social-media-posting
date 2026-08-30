# @bozonx/social-posting-dailymotion

Dailymotion support for [`@bozonx/social-posting`](https://www.npmjs.com/package/@bozonx/social-posting).
Zero runtime dependencies, Web APIs only — it runs on Node, Bun, Deno and Cloudflare Workers.

```bash
pnpm add @bozonx/social-posting @bozonx/social-posting-dailymotion
```

```ts
import { createPostingClient } from '@bozonx/social-posting';
import { dailymotion } from '@bozonx/social-posting-dailymotion';

const client = createPostingClient({
  platforms: [dailymotion],
  credentialProvider, // Dailymotion tokens expire; see "Credentials"
  accounts: {
    channel: {
      platform: 'dailymotion',
      auth: { accessToken: '…', refreshToken: '…', expiresAt: '…' },
      oauthClient: {
        clientId: process.env.DM_CLIENT_ID!,
        clientSecret: process.env.DM_CLIENT_SECRET,
      },
    },
  },
});

const result = await client.post({
  platform: 'dailymotion',
  account: 'channel',
  type: 'video',
  title: 'Release notes, August',
  body: 'Everything that shipped this month.',
  media: [{ type: 'video', source: { kind: 'url', url: 'https://cdn.example.com/august.mp4' } }],
});

// result.data.status === 'processing' — see below.
```

## Three steps, and only the last one creates anything

1. `GET /file/upload` issues a short-lived, single-use signed upload URL.
2. The file is `POST`ed to that URL as `multipart/form-data`, in one request.
3. `POST /me/videos` creates the video, pointing at what was uploaded.

Nothing exists as a video until step 3 succeeds. A failure in step 2 leaves an orphaned file that
Dailymotion discards on its own.

**Step 2 cannot be resumed.** The upload endpoint has no offset protocol, so an interrupted upload
starts over. This adapter therefore issues **no resume handle for the upload** — a handle that
cannot actually resume is worse than none, because a host would keep progress it can never
continue from. `runChunkedUpload()` is deliberately not used here.

## An uploaded video is not a published video

`publish()` returns `processing` with a handle; the host polls `checkStatus()` until Dailymotion's
`status` reads `published`, or one of `encoding_error` / `rejected` / `deleted`.

Budget the wait from `capabilities.asyncProcessing` rather than from a constant of your own.

## Credentials

Dailymotion access tokens expire. Supply a `credentialProvider` whose `onCredentialsRefreshed()`
persists the result, and put `oauthClient.clientId` (with the secret, for a confidential client) on
the account. Without both, the account works until the current token lapses and then needs a human.

The `manage_videos` scope is required; a token issued without it authenticates and then refuses
every upload.

## What it publishes

| Field                    | Maps to                                              |
| ------------------------ | ---------------------------------------------------- |
| `title`                  | `title` (required, ≤ 255)                            |
| `body` / `description`   | `description` (≤ 3000)                               |
| `tags`                   | `tags`, comma-joined (≤ 20)                          |
| `language`               | `language`                                           |
| `visibility`             | `published` — `public` → true, anything else → false |
| `extra.channel`          | `channel`, Dailymotion's own content category        |
| `extra.isCreatedForKids` | `is_created_for_kids`                                |
| `extra.geoblocking`      | `geoblocking`                                        |

The default is **private**: a mis-wired host must not publish to the world by omission.

## Known limits

- Videos only. No text posts, no images, no galleries, no stories, and no Shorts equivalent —
  a vertical video is an ordinary upload, so `shortVideo` is absent rather than aliased to `video`.
- There is no draft and no publish-later endpoint. `mode: 'draft'` and `scheduledAt` are refused
  rather than silently dropped; schedule the job on your side instead.
- Upload count and total published duration are capped by account status (ordinary, verified,
  partner) rather than by anything the API states. Exhaustion arrives as a `limit_reached_error`
  and is classified as `QUOTA_EXCEEDED`.
- `delete()` is not implemented in this iteration, and `supportsDeletion` says so.
