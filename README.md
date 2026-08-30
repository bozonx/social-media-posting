# Social posting

A web-standard library for publishing to social networks. Every network is an isolated package
implementing one stable contract; adding one is meant to be the only work left.

- **`@bozonx/social-posting`** — the core. Zero runtime dependencies, no framework.
- **`@bozonx/social-posting-telegram`**, **`@bozonx/social-posting-discord`** — the networks. One
  package per network.
- **`@bozonx/social-posting-conformance`** — the contract suite every network must pass.
- **`apps/server`** — an HTTP shell for non-Node callers. Not published to npm; ships as a Docker
  image and a Cloudflare Workers deployment.

## What it does, and what it deliberately does not

| Concern                                                            | Owner            |
| ------------------------------------------------------------------ | ---------------- |
| Translating a request into platform API calls                      | **this library** |
| Choreographing a multi-step publication                            | **this library** |
| Classifying failures (`retryable`, `retryAfterMs`, `resumeHandle`) | **this library** |
| Resuming an interrupted publication                                | **this library** |
| Capability metadata: limits, types, formats                        | **this library** |
| Refreshing an OAuth2 token (not storing it)                        | **this library** |
| Retrying, backoff, dead-lettering                                  | your application |
| Remembering that a post already went out                           | your application |
| Rate limiting across processes                                     | your application |
| Storing and encrypting credentials                                 | your application |
| The OAuth authorization-code redirect                              | your application |

The library holds no durable state, so anything that needs durable state to be correct is yours.
One call makes **one attempt**; every failure tells you whether repeating it could work, how long
to wait, and — for a multi-step publication — where to resume. See
[`docs/DELIVERY-SEMANTICS.md`](docs/DELIVERY-SEMANTICS.md).

## Install

```bash
pnpm add @bozonx/social-posting @bozonx/social-posting-telegram
```

Node 24, or any runtime with `fetch`, WHATWG streams and Web Crypto — Cloudflare Workers, Deno and
Bun included.

## Quick start

```ts
import { createPostingClient } from '@bozonx/social-posting';
import { telegram } from '@bozonx/social-posting-telegram';

const client = createPostingClient({
  accounts: {
    myChannel: {
      platform: 'telegram',
      auth: { apiKey: process.env.TELEGRAM_BOT_TOKEN! },
      target: '@my_channel',
    },
  },
  platforms: [telegram],
});

const result = await client.post({
  platform: 'telegram',
  account: 'myChannel',
  body: 'Hello from a posting client.',
});

if (result.success) {
  console.log(result.data.postId, result.data.url);
} else if (result.error.retryable) {
  scheduleRetry(result.error.retryAfterMs ?? 60_000, result.error.resumeHandle);
} else {
  deadLetter(result.error);
}
```

`client.preview(request)` runs the same validation without publishing, and returns the request as
the network will actually receive it (`adaptedRequest`), so a host needs no formatter of its own.
`client.getCapabilities('telegram')` returns what the network accepts, as data;
`client.resolveCapabilities(request)` asks a network what it accepts for one account, right now —
the library caches nothing and hands back `cacheableForSecs` for the host to honour.

`target` is a scalar shorthand or a structural address, and the library normalizes the first into
the second before any adapter sees it:

```ts
target: { id: '@my_channel', messageThreadId: 42 }
```

Two clients can live in one process with different accounts and different loggers: the library
mutates no global state and never touches an ambient logger.

## Supported networks

| Network  | Package                           | Media by URL | Byte upload | Deferred results |
| -------- | --------------------------------- | ------------ | ----------- | ---------------- |
| Telegram | `@bozonx/social-posting-telegram` | yes          | no          | no               |
| Discord  | `@bozonx/social-posting-discord`  | yes¹         | yes         | no               |

¹ Discord never fetches a URL: the adapter downloads it and uploads the bytes, so the URL must be
reachable from your process rather than from Discord.

Adding the next one: [`CONTRIBUTING-PLATFORMS.md`](CONTRIBUTING-PLATFORMS.md).

## Handling failures

Everything a caller needs is on the error, so nothing has to be parsed out of a message:

```ts
if (!result.success) {
  const { code, retryable, retryAfterMs, resumeHandle } = result.error;
}
```

| Code                    | Meaning                                                           |
| ----------------------- | ----------------------------------------------------------------- |
| `VALIDATION_ERROR`      | The request cannot be published as written. Never retryable.      |
| `AUTH_ERROR`            | Credentials missing, malformed or rejected.                       |
| `AUTH_REFRESH_REQUIRED` | The grant is gone. Re-authorize the channel; never retry.         |
| `RATE_LIMIT_ERROR`      | Slow down. `retryAfterMs` carries the network's own cool-down.    |
| `QUOTA_EXCEEDED`        | A per-period allowance is spent.                                  |
| `CONTENT_REJECTED`      | Moderation or policy refused the content. Retrying will not help. |
| `PLATFORM_ERROR`        | The network failed on its side.                                   |
| `NETWORK_ERROR`         | The network could not be reached.                                 |
| `TIMEOUT_ERROR`         | The call did not finish within `requestTimeoutSecs`.              |
| `UNKNOWN_OUTCOME`       | The post may or may not exist. Check the account; never resend.   |
| `INTERNAL_ERROR`        | An unexpected failure inside this library.                        |

Store `resumeHandle` before scheduling a retry. It is plain JSON precisely so it fits in a job
record, and dropping it turns a safe resume into a duplicate post.

## Deferred publication

Some networks accept content and materialize the post minutes later. A successful `post()` can
therefore come back as `status: 'processing'` with no `postId`:

```ts
if (result.success && result.data.status === 'processing') {
  const status = await client.checkStatus(request, result.data.handle!);
}
```

Nothing in this library polls — polling needs a scheduler, and a scheduler needs durable state.

## HTTP shell

For callers that are not Node. Same behaviour, same result shapes, no extra guarantees:

```bash
pnpm docker:build && pnpm docker:up
curl -X POST localhost:8080/api/v1/post -H 'content-type: application/json' -d '{ … }'
```

See [`apps/server/README.md`](apps/server/README.md) for the API, and
[`docs/RUNTIMES.md`](docs/RUNTIMES.md) for what a Cloudflare Workers deployment can and cannot do.

## Documentation

|                                                                                |                                              |
| ------------------------------------------------------------------------------ | -------------------------------------------- |
| [`packages/core/README.md`](packages/core/README.md)                           | The library API                              |
| [`packages/platform-telegram/README.md`](packages/platform-telegram/README.md) | Telegram reference                           |
| [`packages/platform-discord/README.md`](packages/platform-discord/README.md)   | Discord reference                            |
| [`apps/server/README.md`](apps/server/README.md)                               | The HTTP API                                 |
| [`CONTRIBUTING-PLATFORMS.md`](CONTRIBUTING-PLATFORMS.md)                       | Adding a network                             |
| [`docs/DELIVERY-SEMANTICS.md`](docs/DELIVERY-SEMANTICS.md)                     | Duplicate risk, and who owns it              |
| [`docs/PLATFORM-SPECIFICS.md`](docs/PLATFORM-SPECIFICS.md)                     | What each network demands of your app        |
| [`docs/OAUTH.md`](docs/OAUTH.md)                                               | Credentials, token refresh, re-authorization |
| [`docs/RUNTIMES.md`](docs/RUNTIMES.md)                                         | Node, Workers, Deno, Bun                     |
| [`docs/CHANGELOG.md`](docs/CHANGELOG.md)                                       | What changed, and why                        |

## Development

```bash
pnpm install
pnpm build            # every package
pnpm check            # static analysis only (typecheck, lint, format check)
pnpm validate         # check + unit tests
pnpm validate:all     # full verification — static analysis, deps, build, strict types, unit, e2e, workerd, publish checks
pnpm platform <name>  # scaffold a new network package
```

Two rules the tooling enforces rather than trusts: published packages declare **no runtime
dependencies**, and they import **no Node built-ins**. ESLint catches the second by hand; the
`workerd` run catches it through a transitive dependency.

## License

MIT
