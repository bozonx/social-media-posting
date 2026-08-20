# Runtimes

The packages are written against web standards — `fetch`, `Request`/`Response`, WHATWG streams,
Web Crypto — so the same build runs on Node, Cloudflare Workers, Deno and Bun. The HTTP shell is
built on Hono for the same reason, and ships as two artefacts from one source: a Docker image
(Node) and a Workers deployment (`wrangler`).

That discipline is enforced, not merely intended. ESLint refuses a Node built-in inside
`packages/**`, and the core test suite runs a second time inside `workerd` (`pnpm test:workerd`).
A lint rule catches a typo; the `workerd` run catches a transitive dependency.

## What actually limits a Workers deployment

The constraint is not the language surface — it is memory and request size. A Worker isolate has a
modest memory ceiling and a cap on request body size, and neither is negotiable from inside the
Worker. So the question for any given network is: **do the media bytes have to pass through this
process?**

That is declared in each platform's capability descriptor under `media[type].acceptedSources`:

| `acceptedSources` includes | Meaning                                            | Consequence on Workers                                               |
| -------------------------- | -------------------------------------------------- | -------------------------------------------------------------------- |
| `'url'`                    | The network fetches media itself from a public URL | Bytes never enter the Worker. Fine at any media size.                |
| `'bytes'` / `'blob'`       | The library must move the bytes                    | Fine for images of a few MB; a large video will exhaust the isolate. |

Read a network's own answer at runtime:

```ts
const capabilities = client.getCapabilities('telegram');
const acceptsUrl = capabilities.media?.image?.acceptedSources.includes('url');
```

## Suitability by content type

Structurally, and independent of any specific limit numbers:

| Content                                                | Workers       | Node |
| ------------------------------------------------------ | ------------- | ---- |
| Text posts, links, polls                               | yes           | yes  |
| Media by public URL, on a network that accepts `'url'` | yes           | yes  |
| Images pushed as bytes, a few MB                       | yes           | yes  |
| Large video, chunked upload of hundreds of MB          | no — use Node | yes  |

Cloudflare's exact limits change, and vary by plan. This document deliberately states the _shape_
of the constraint rather than a number that will silently go stale; check
[Cloudflare's platform limits](https://developers.cloudflare.com/workers/platform/limits/) for
current figures.

The `MediaFetcher` and `runChunkedUpload` helpers hold one chunk at a time rather than the whole
file, so "large video will exhaust the isolate" is about the total transfer and the request body
cap, not about a careless buffer in this library. A 64 MiB streaming test asserts the high-water
mark.

## Configuration differs by runtime

A Worker has no filesystem, so it cannot read `config.yaml`:

|                        | Node / Docker                                        | Workers                      |
| ---------------------- | ---------------------------------------------------- | ---------------------------- |
| Platform configuration | `config.yaml` (path from `CONFIG_PATH`)              | `CONFIG_JSON` secret         |
| Bearer tokens          | `AUTH_BEARER_TOKENS` env                             | `AUTH_BEARER_TOKENS` secret  |
| Entry point            | `dist/entry/node.js`                                 | `dist/entry/worker.js`       |
| Graceful drain         | SIGTERM, health turns 503, in-flight requests finish | the platform's own lifecycle |

```bash
# Workers
wrangler secret put CONFIG_JSON     # the same structure as config.yaml, as JSON
wrangler secret put AUTH_BEARER_TOKENS
pnpm --filter @bozonx/social-posting-server deploy:worker

# Docker
pnpm docker:build && pnpm docker:up
```

## Node version

One version, stated in `.nvmrc`, and matched by `package.json#engines.node`, the Dockerfile and CI.
