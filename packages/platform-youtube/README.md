# @bozonx/social-posting-youtube

YouTube support for [`@bozonx/social-posting`](https://www.npmjs.com/package/@bozonx/social-posting).
Zero runtime dependencies, Web APIs only — it runs on Node, Bun, Deno and Cloudflare Workers.

```bash
pnpm add @bozonx/social-posting @bozonx/social-posting-youtube
```

```ts
import { createPostingClient } from '@bozonx/social-posting';
import { youtube } from '@bozonx/social-posting-youtube';

const client = createPostingClient({
  platforms: [youtube],
  credentialProvider, // see "Credentials" below — not optional in practice
  accounts: {
    main: {
      platform: 'youtube',
      auth: { accessToken: '…', refreshToken: '…', expiresAt: '…' },
      oauthClient: {
        clientId: process.env.GOOGLE_CLIENT_ID!,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      },
    },
  },
});

const result = await client.post({
  platform: 'youtube',
  account: 'main',
  type: 'video',
  title: 'Release notes, August',
  body: 'Everything that shipped this month.',
  visibility: 'private',
  media: [{ type: 'video', source: { kind: 'stream', open: openFile, sizeBytes: 812_000_000 } }],
});

// result.data.status === 'processing' — see below.
```

## An uploaded video is not a published video

`publish()` **never** returns `published`. `videos.insert` answers with a video id the moment the
last byte lands, and YouTube then transcodes for anywhere between a few seconds and several hours.
A host that treats the id as proof of publication announces a video its audience gets a spinner
for.

So the flow is always two-phase:

1. `post()` returns `status: 'processing'` with a `handle` and a `checkAfterMs`.
2. The host calls `checkStatus(request, handle)` until it answers `published` or `failed`.

`checkStatus()` reads `processingDetails.processingStatus`, not `status.uploadStatus` — the latter
reads `uploaded` for a file still being transcoded.

**Budget the wait from the descriptor, not from a constant.** `capabilities.asyncProcessing`
states `maxWaitSecs` (6 hours here) and `pollIntervalSecs`. A host with one global 15-minute
timeout marks successful uploads of long videos as failures.

## Credentials

A Google access token lives about an hour, which is less than a large upload takes. This adapter
therefore refreshes **before** the upload starts rather than reacting to a 401 halfway through.

For that it needs two things:

- a `credentialProvider` on the client, whose `onCredentialsRefreshed()` **persists the result**;
- `oauthClient.clientId` (and secret, for a confidential client) on the account.

Google rotates refresh tokens. A rotated token that is not persisted locks the channel out
permanently — no retry recovers it, and the user must go through consent again. If your provider
has no `onCredentialsRefreshed`, this account works until the current access token expires and then
stops for good.

Scopes: `youtube.upload` is enough to insert a video. `youtube` is additionally needed to read
processing status back and to set a custom thumbnail.

## Quota is units, not posts

One `videos.insert` costs **1600 quota units** against the Google Cloud project's daily budget,
which defaults to 10 000 — roughly six uploads a day, for every channel the project serves
combined. An exhausted budget surfaces as `QUOTA_EXCEEDED` and resets at midnight Pacific time,
which no `retry-after` header states.

This is a different failure from Vimeo's, which is storage. Both are `QUOTA_EXCEEDED`;
`capabilities.rateLimits.quotaCost.unit` is what tells them apart (`quotaUnits` against `bytes`),
and it is what a host should branch on to say "try tomorrow" rather than "free up space".

## Shorts

`shortVideo` and `video` are the same `videos.insert` call with the same limits. There is no Shorts
endpoint: YouTube classifies a Short from the finished file's aspect ratio and duration, after the
upload, by rules that belong to the product and change without an API version.

Submitting a landscape video as `shortVideo` logs a warning and uploads it anyway — refusing would
reject uploads YouTube itself would have accepted.

## Resumable upload

Large uploads run over Google's resumable protocol: a session is opened, chunks are `PUT` by byte
offset, and the last one returns the video.

On failure the error carries a `resumeHandle`. Passing it back to `publish()` continues the upload
instead of starting over:

```ts
const result = await client.post(request, { resume: previousError.resumeHandle });
```

Two details worth knowing:

- The handle carries the session's opaque `upload_id`, never the signed session URL, so it is safe
  in a host's database. `findResumeHandleSecrets()` on it returns nothing.
- Before resuming, the adapter asks YouTube where the file actually got to. The stored offset is
  only what was true before the process died; resuming from a guessed byte produces a corrupt file
  rather than a visible error.

`chunkSizeBytes` on the account tunes the writes. It must be a multiple of 256 KiB — Google's own
requirement — and an invalid value is refused before a session is opened rather than rounded.

## Drafts and scheduling

There is **no draft**. A `private` video is uploaded, stored and has already cost its 1600 units;
`mode: 'draft'` is refused rather than quietly mapped onto privacy.

`scheduledAt` maps to `status.publishAt`, which YouTube honours **only while the video is private**.
Setting it on a public video is refused, because YouTube would otherwise ignore it silently — the
worst of the three possible outcomes.

## What it publishes

| Field                     | Maps to                                              |
| ------------------------- | ---------------------------------------------------- |
| `title`                   | `snippet.title` (required, ≤ 100)                    |
| `body` / `description`    | `snippet.description` (≤ 5000)                       |
| `tags`                    | `snippet.tags` (≤ 500 characters joined)             |
| `language`                | `snippet.defaultLanguage` and `defaultAudioLanguage` |
| `visibility`              | `status.privacyStatus` (`private` by default)        |
| `thumbnail`               | a separate `thumbnails.set` call after the insert    |
| `extra.categoryId`        | `snippet.categoryId` (account default, then `22`)    |
| `extra.madeForKids`       | `status.selfDeclaredMadeForKids`                     |
| `extra.notifySubscribers` | the `notifySubscribers` query parameter              |

A thumbnail that YouTube refuses is logged and does not fail the publication: the video exists and
its quota is spent, and failing here would make the host re-upload a video it already has.

## Known limits

- An unverified channel is capped at 15 minutes of video regardless of file size. That is a
  property of the channel, not of the API, so the descriptor does not state it.
- A project whose OAuth consent screen has not been verified can only upload `private` videos.
- `delete()` is not implemented in this iteration, and `supportsDeletion` says so.
