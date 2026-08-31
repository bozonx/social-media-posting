# Using the library

This guide describes the end-to-end host integration. It intentionally keeps platform limits out
of code examples: obtain them from capabilities instead of duplicating values that can change.

## 1. Install and register only the adapters you use

```bash
pnpm add @bozonx/social-posting @bozonx/social-posting-telegram
```

```ts
import { createPostingClient } from '@bozonx/social-posting';
import { telegram } from '@bozonx/social-posting-telegram';

const client = createPostingClient({
  platforms: [telegram],
  accounts: {
    announcements: {
      platform: 'telegram',
      auth: { apiKey: process.env.TELEGRAM_BOT_TOKEN! },
      target: '@announcements',
    },
  },
  credentialProvider,
  logger,
});
```

The core contains no adapters. `platform` in a request must match a registered module and the
named account's platform. Prefer named accounts over inline `auth`: they give credential refresh
a stable account reference and keep secrets out of jobs.

## 2. Build a request

```ts
const request = {
  platform: 'telegram',
  account: 'announcements',
  type: 'image',
  body: 'Release 2.0 is live.',
  bodyFormat: 'text',
  media: [
    {
      type: 'image',
      altText: 'The 2.0 release dashboard',
      source: { kind: 'url', url: 'https://cdn.example.com/release.png' },
    },
  ],
} as const;
```

`PostRequest` has four groups of fields:

- Routing: `platform`, `account` or inline `auth`, and `target`.
- Content: `body`, `bodyFormat`, `type`, title/description/tags/language, `article`, and `thread`.
- Media and structure: `media`, `thumbnail`, `poll`, `location`, `inReplyTo`, and `repostOf`.
- Delivery and policy: visibility, sensitive/content-warning fields, `scheduledAt`, `mode`,
  `idempotencyKey`, and typed platform `extra`.

`target` can be a string/number shorthand or `{ id, ...platformFields }`. The core normalizes it
before an adapter sees it. For example, Pinterest adds `sectionId`, Discord adds `guildId` and
`threadId`, and Telegram adds `messageThreadId`. Read `capabilities.targetSchema` rather than
inventing keys.

Media sources are explicit:

```ts
type MediaSourceInput =
  | { kind: 'url'; url: string }
  | { kind: 'bytes'; bytes: Uint8Array }
  | { kind: 'blob'; blob: Blob }
  | { kind: 'stream'; open: MediaStreamFactory; sizeBytes?: number }
  | { kind: 'platformRef'; ref: string };
```

A `platformRef` is platform-native: a Telegram `file_id`, a LinkedIn asset URN, an X media id, or
a Pinterest media id. It is not portable between platforms. A stream factory must be reopenable
at a requested byte offset when resumable upload is used.

When `type` is absent or `auto`, the core detects only structural forms: poll, multiple media,
one media item, or text. It never guesses a Story, Reel/Short, or native Article from orientation
or length. Set those types explicitly.

## 3. Resolve capabilities and preview

```ts
const resolved = await client.resolveCapabilities({
  platform: request.platform,
  account: request.account,
});

const preview = await client.preview(request, {
  capabilities: resolved.capabilities,
});

if (!preview.success || !preview.data.valid) {
  // Localize Issue.code + Issue.params; message is English diagnostic text.
  return showValidation(preview);
}

enqueue({ request, capabilities: resolved.capabilities });
```

`getCapabilities(platform)` is static and synchronous. `resolveCapabilities(request)` can call the
network for facts that differ by account or instance and returns `cacheableForSecs`. A value of
zero means resolve before every publication. The library does not cache the answer.

`preview()` performs no publication. It returns stable issue codes, ignored-field warnings, body
conversion, the normalized `adaptedRequest`, and `requiredMediaUrlLifetimeSecs` for pull media.
Use `adaptedRequest` to show or audit what will be sent; keep the original `PostRequest` for
`post()`. Do not maintain a second platform formatter in the host.

## 4. Publish exactly once per attempt

```ts
const result = await client.post(request, {
  resume: job.resumeHandle,
  signal: abortController.signal,
});

if (!result.success) {
  if (result.error.code === 'UNKNOWN_OUTCOME') {
    return flagForHumanCheck(job, result.error);
  }
  if (!result.error.retryable) return deadLetter(job, result.error);

  await saveResumeHandle(job, result.error.resumeHandle);
  return scheduleRetry(job, result.error.retryAfterMs ?? backoff(job.attempts));
}

await savePostRef(job, result.data.ref);

if (result.data.status === 'processing') {
  await saveProcessingHandle(job, result.data.handle);
  return scheduleStatusCheck(job, result.data.checkAfterMs);
}

return markPublished(job, result.data);
```

Expected platform failures are returned as results. The host may still use `try/catch` for its own
bugs or surrounding infrastructure, but it must branch on `success` for normal operation.

The full `ref` is the canonical durable identity. It can contain multiple `parts`, which matters
for flows that create containers, uploaded assets, or several native objects. `postId` alone is
not enough for later deletion or reconciliation.

## 5. Follow processing without polling inside the request

```ts
const status = await client.checkStatus(
  { platform: job.platform, account: job.account },
  job.processingHandle,
);

if (status.success && status.data.status === 'processing') {
  scheduleStatusCheck(job, status.data.checkAfterMs);
}
```

The host supplies the scheduler and durable state. Stop according to
`capabilities.asyncProcessing.maxWaitSecs`, not a global timeout: video transcodes and Meta/TikTok
containers have very different processing windows.

## 6. Handle errors by code and policy

| Code                                               | Host action                                                          |
| -------------------------------------------------- | -------------------------------------------------------------------- |
| `VALIDATION_ERROR`                                 | Ask the user to change the request; do not retry.                    |
| `AUTH_ERROR`                                       | Check credentials/permissions; retry only if `retryable` says so.    |
| `AUTH_REFRESH_REQUIRED`                            | Mark the account disconnected and run authorization again.           |
| `RATE_LIMIT_ERROR`                                 | Schedule after `retryAfterMs`.                                       |
| `QUOTA_EXCEEDED`                                   | Explain the platform-specific quota; inspect capability quota units. |
| `CONTENT_REJECTED`                                 | Surface moderation/policy refusal; do not retry unchanged content.   |
| `PLATFORM_ERROR`, `NETWORK_ERROR`, `TIMEOUT_ERROR` | Follow `retryable`; retain resume state.                             |
| `UNKNOWN_OUTCOME`                                  | The post may exist. Reconcile or ask a human; never resend blindly.  |
| `INTERNAL_ERROR`                                   | Alert and investigate the library/adapter path.                      |

Never parse `message`. Use `code`, `platformCode`, `httpStatus`, `retryable`, `retryAfterMs`, and
structured details. Raw provider payloads are omitted unless `includeRaw` is requested and may
contain sensitive user content.

## 7. Production checklist

- Persist credential rotations, resume handles, processing handles, and the complete post ref.
- Record an attempt before sending it so a lost response is not treated as a safe retry.
- Resolve dynamic capabilities at their declared cadence.
- Generate signed URLs only after preview and give them at least the required lifetime.
- Use Node for large pushed uploads; the JSON HTTP shell and Workers are not large-video ingress.
- Test with the real account class and app approval level used in production.
- Treat platform scopes, API products, account eligibility, and legal access as release gates.

Continue with [delivery semantics](DELIVERY-SEMANTICS.md), [OAuth](OAUTH.md), and the
[platform guide](PLATFORM-SPECIFICS.md).
