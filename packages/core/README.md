# @bozonx/social-posting

The framework-free core of a social posting library. Zero runtime dependencies; targets web
standards, so the same build runs on Node, Cloudflare Workers, Deno and Bun.

It ships no network of its own. Install the ones you need alongside it —
[`@bozonx/social-posting-telegram`](https://www.npmjs.com/package/@bozonx/social-posting-telegram),
or your own.

```bash
pnpm add @bozonx/social-posting @bozonx/social-posting-telegram
```

## Creating a client

```ts
import { createPostingClient } from '@bozonx/social-posting';
import { telegram } from '@bozonx/social-posting-telegram';

const client = createPostingClient({
  accounts: {
    myChannel: { platform: 'telegram', auth: { apiKey: '…' }, target: '@my_channel' },
  },
  requestTimeoutSecs: 60,
  platforms: [telegram],
  logger, // optional; nothing global is ever reconfigured
  credentialProvider, // optional; see docs/OAUTH.md
});
```

| Option               | Meaning                                                    |
| -------------------- | ---------------------------------------------------------- |
| `accounts`           | Named credentials and per-account defaults                 |
| `requestTimeoutSecs` | Overall limit for one publish call (default 60)            |
| `platforms`          | The `PlatformModule` descriptors to serve                  |
| `logger`             | An `ILogger`; defaults to a console logger at `logLevel`   |
| `logLevel`           | `debug` \| `info` \| `warn` \| `error` (default `warn`)    |
| `credentialProvider` | Where credentials come from and where rotated ones go back |
| `fetch`              | Custom `fetch` function (for proxies or testing)           |

There is deliberately no retry setting. One call makes one attempt.

## Client API

```ts
client.post(request, { signal?, resume?, includeRaw? }); // publish once
client.delete(request, ref, { signal?, resume?, includeRaw? }); // delete a post
client.preview(request);                      // validate without publishing
client.checkStatus(request, handle, signal?); // follow up a 'processing' publication
client.resolveCapabilities(request, signal?); // account-specific limits; never cached here
client.getQuota(request, signal?);             // remaining allowance where supported
client.registerPlatform(platformModule);      // add a network at runtime
client.getRegisteredPlatforms();              // string[]
client.getCapabilities(platform);             // PlatformCapabilities
```

## The request

```ts
interface PostRequest {
  platform: string; // 'telegram'
  account?: string; // a named account …
  auth?: Record<string, unknown>; // … or inline credentials
  target?: string | number | { id: string; [key: string]: unknown };

  body?: string;
  bodyFormat?: BodyFormat; // 'text' | 'html' | 'md' | 'MarkdownV2'
  type?: PostType; // omit for auto-detection
  title?: string;
  description?: string;
  article?: ArticleDocument;
  thread?: PostSegment[];

  media?: MediaInput[]; // array of MediaInput items
  thumbnail?: ThumbnailInput; // dedicated preview asset

  tags?: string[];
  language?: string;
  scheduledAt?: string; // rejected where the network cannot schedule
  mode?: 'publish' | 'draft'; // rejected where the network has no drafts
  silent?: boolean;
  visibility?: Visibility; // 'public' | 'unlisted' | 'private' | 'direct'
  inReplyTo?: PlatformObjectRef;
  repostOf?: PlatformObjectRef;
  poll?: PollInput;
  location?: LocationInput;
  extra?: Record<string, unknown>; // platform-specific extra payload
}
```

`media[].source` is a discriminated union: `{ kind: 'url', url }`, `{ kind: 'bytes', bytes }`,
`{ kind: 'blob', blob }`, `{ kind: 'stream', open, sizeBytes? }`, or
`{ kind: 'platformRef', ref }`. A platform reference is native to that network (a Telegram
`file_id`, for instance), not a generic URL.

A field a network cannot honour is **rejected**, not silently dropped. A field it accepts and
ignores comes back as a preview warning naming it.

## The result

```ts
type PostResult =
  | {
      success: true;
      data: {
        status: 'published' | 'processing';
        postId?: string;
        url?: string;
        parts?: PostPart[];
        ref?: PostRef;
        handle?: ResumeHandle;
        checkAfterMs?: number;
        platform: string;
        type: PostType;
        publishedAt: string;
        raw?: Record<string, unknown>; // only when includeRaw is true
        requestId: string;
      };
    }
  | {
      success: false;
      error: {
        code: ErrorCode;
        message: string;
        retryable: boolean;
        retryAfterMs?: number;
        httpStatus?: number;
        platformCode?: string;
        resumeHandle?: ResumeHandle;
        issues?: Issue[];
        details?: Record<string, unknown>;
        raw?: unknown; // only when includeRaw is true
        requestId: string;
      };
    };
```

`post()` and `delete()` never throw for an expected failure, so branching on `success` replaces a try/catch
around every call.

Raw platform payloads are diagnostic and may contain sensitive content. They are omitted by
default; pass `includeRaw: true` only when the caller is allowed to receive them.

## Retrying is yours

```ts
const result = await client.post(request, { resume: job.resumeHandle });

if (result.success) return markPublished(job, result.data);
if (!result.error.retryable) return deadLetter(job, result.error);

job.resumeHandle = result.error.resumeHandle; // persist before scheduling
scheduleRetry(job, result.error.retryAfterMs ?? backoff(job.attempts));
```

The one exception is transport-level: `httpRequest()` repeats a request once when the connection
died before the request completed and the body can be replayed. A request the platform may already
have seen is never repeated automatically.

## Implementing a network

```ts
import type { PlatformModule } from '@bozonx/social-posting';
import type { IPlatform } from '@bozonx/social-posting/platform';

export const mastodon: PlatformModule = {
  name: 'mastodon',
  capabilities: mastodonCapabilities, // types, limits, formats, transport traits
  create: deps => new MastodonPlatform(deps),
  authValidator: new MastodonAuthValidator(),
};
```

The core exports adapter utilities via `@bozonx/social-posting/platform`: `IPlatform`, `PlatformCapabilities`, `PlatformError`,
`ResumeHandle`, `validateAgainstCapabilities()`, `previewFromCapabilities()`, `httpRequest()`,
`MediaFetcher`, `runChunkedUpload()`, `OAuth2TokenRefresher`, and the body-rendering helpers.

Run [`@bozonx/social-posting-conformance`](https://www.npmjs.com/package/@bozonx/social-posting-conformance)
against it, and see `CONTRIBUTING-PLATFORMS.md`.

## Runtime

`fetch`, `Request`/`Response`, WHATWG streams, Web Crypto, `URL`. No Node built-ins — enforced by
lint and by running the whole test suite inside `workerd`.

## License

MIT
