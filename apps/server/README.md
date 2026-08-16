# HTTP shell

An HTTP wrapper around [`@bozonx/social-posting`](../../packages/core) for callers that are not
Node — Python, Go, PHP, or a self-hosted deployment. It is **not published to npm**; it ships as a
Docker image and a Cloudflare Workers deployment, built from the same source.

The shell is strictly stateless. It parses JSON, calls the library, and returns the result. It
stores nothing, retries nothing and deduplicates nothing, so an HTTP caller has exactly the same
capabilities — and exactly the same responsibilities — as an in-process one. See
[`docs/DELIVERY-SEMANTICS.md`](../../docs/DELIVERY-SEMANTICS.md).

## Running it

```bash
pnpm docker:build && pnpm docker:up          # Docker
pnpm --filter @bozonx/social-posting-server deploy:workers   # Cloudflare Workers
```

|                | Node / Docker                                        | Workers                  |
| -------------- | ---------------------------------------------------- | ------------------------ |
| Configuration  | `config.yaml` (path from `CONFIG_PATH`)              | the `CONFIG_JSON` secret |
| Entry point    | `dist/entry/node.js`                                 | `dist/entry/worker.js`   |
| Graceful drain | SIGTERM: health turns 503, in-flight requests finish | the platform's lifecycle |

What a Workers deployment can and cannot publish: [`docs/RUNTIMES.md`](../../docs/RUNTIMES.md).

## Environment

| Variable                          | Default         | Meaning                                               |
| --------------------------------- | --------------- | ----------------------------------------------------- |
| `LISTEN_HOST`                     | `0.0.0.0`       | Bind address                                          |
| `LISTEN_PORT`                     | `8080`          | Bind port                                             |
| `BASE_PATH`                       | —               | Prefix in front of `api/v1`                           |
| `LOG_LEVEL`                       | `warn`          | `debug` \| `info` \| `warn` \| `error` \| `silent`    |
| `AUTH_BEARER_TOKENS`              | —               | Comma-separated; unset means no authentication        |
| `ALLOW_INLINE_AUTH`               | `false`         | Allow credentials in request bodies                   |
| `INCLUDE_RAW_RESPONSES`           | `false`         | Return diagnostic platform payloads                   |
| `MAX_REQUEST_BODY_BYTES`          | `1048576`       | JSON body limit (1 KiB–10 MiB)                        |
| `SHUTDOWN_DRAIN_SECONDS`          | `5`             | How long to answer 503 before closing                 |
| `CONFIG_PATH`                     | `./config.yaml` | Configuration file (Node only)                        |
| `CONFIG_JSON`                     | —               | The whole configuration as JSON (required on Workers) |
| `SERVICE_NAME`, `SERVICE_VERSION` |                 | Reported by `/health`                                 |

## Configuration

```yaml
requestTimeoutSecs: 60

accounts:
  company_telegram:
    platform: telegram
    auth:
      apiKey: ${TELEGRAM_BOT_TOKEN} # resolved from the environment, never written here
    channelId: '@my_channel'
```

There is deliberately no retry or idempotency setting.

## API

Everything lives under `/{BASE_PATH}/api/v1`. Authentication is `Authorization: Bearer <token>`
when `AUTH_BEARER_TOKENS` is set; `/health` never requires it.

### `POST /post`

Body: the library's [`PostRequest`](../../packages/core/README.md#the-request), plus an optional
`resume` handle from a previous failed attempt.

By default requests must name a configured `account`. Set `ALLOW_INLINE_AUTH=true` only for a
trusted deployment whose callers may supply social-network credentials. Raw platform payloads are
similarly omitted unless `INCLUDE_RAW_RESPONSES=true`.

```bash
curl -X POST localhost:8080/api/v1/post \
  -H 'content-type: application/json' \
  -d '{
    "platform": "telegram",
    "account": "company_telegram",
    "body": "Hello world"
  }'
```

Answers **200** with the result, whether the publication succeeded or not — a publish failure is a
result, not an HTTP error, so a caller reads `success` in one place:

```json
{ "success": true, "data": { "status": "published", "postId": "123", "url": "https://t.me/…" } }
```

```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMIT_ERROR",
    "message": "Too Many Requests: retry after 30",
    "retryable": true,
    "retryAfterMs": 30000,
    "httpStatus": 429,
    "requestId": "…"
  }
}
```

Store `error.resumeHandle` when present and send it back as `resume` on the next attempt: without
it, a retry of a multi-step publication uploads a second file and creates a second post.

### `POST /preview`

Same body. Validates and reports what would happen, without publishing.

### `POST /status`

For a publication that came back `status: "processing"`.

```bash
curl -X POST localhost:8080/api/v1/status \
  -H 'content-type: application/json' \
  -d '{ "platform": "tiktok", "account": "main", "handle": { … } }'
```

The shell polls nothing; you decide when to ask.

### `GET /health`

`200` while serving, `503` while draining.

## Status codes

| Code | When                                                 |
| ---- | ---------------------------------------------------- |
| 200  | The request was handled — read `success` in the body |
| 400  | The body is malformed; `details` names the fields    |
| 401  | Missing or wrong bearer token                        |
| 413  | Request body exceeds `MAX_REQUEST_BODY_BYTES`        |
| 503  | Shutting down                                        |
| 500  | An unexpected failure in the shell                   |
