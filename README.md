# Social Media Posting Microservice

A stateless microservice for publishing content to social media platforms through a unified REST API. Can also be used as a standalone TypeScript library.

## Features

- **Unified API** — Single endpoint for all platforms
- **Telegram Support** — Posts, images, videos, albums, documents, audio
- **Auto Type Detection** — Automatically determines post type from media fields
- **Bearer Auth** — Optional token-based authentication for API requests
- **Idempotency** — Prevents duplicate posts with `idempotencyKey`
- **Retry Logic** — Automatic retries with jitter for transient errors
- **YAML Config** — Environment variable substitution support
- **Library Mode** — Use as a standalone TypeScript library in your projects

## Table of Contents

- [Quick Start](#quick-start)
- [Usage Examples](#usage-examples)
- [API Reference](#api-reference)
- [Configuration](#configuration)
- [Library Mode](#library-mode)
- [Development](#development)
- [Docker](#docker)
- [License](#license)

## Quick Start

### 1. Install

```bash
pnpm install
```

### 2. Configure

```bash
cp .env.example .env
```

Edit `config.yaml` with your Telegram credentials:

```yaml
accounts:
  company_telegram:
    platform: telegram
    auth:
      apiKey: ${MY_TELEGRAM_TOKEN}  # or direct value
    channelId: "@your_channel_username"
```

### 3. Run

```bash
pnpm dev                    # Development
pnpm build && pnpm start    # Production
```

API available at `http://localhost:8080/api/v1`

## Usage Examples

### Text Post

```bash
curl -X POST http://localhost:8080/api/v1/post \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "telegram",
    "account": "company_telegram",
    "body": "<b>Hello!</b> This is a test post",
    "bodyFormat": "html"
  }'
```

### Image Post

```bash
curl -X POST http://localhost:8080/api/v1/post \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "telegram",
    "account": "company_telegram",
    "body": "Check out this image!",
    "cover": {
      "src": "https://example.com/image.jpg"
    }
  }'
```

### Album

```bash
curl -X POST http://localhost:8080/api/v1/post \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "telegram",
    "account": "company_telegram",
    "body": "Photo gallery",
    "media": [
      { "src": "https://example.com/photo1.jpg" },
      { "src": "https://example.com/photo2.jpg" }
    ]
  }'
```

### Image with Spoiler

```bash
curl -X POST http://localhost:8080/api/v1/post \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "telegram",
    "account": "company_telegram",
    "body": "Sensitive content",
    "cover": {
      "src": "https://example.com/image.jpg",
      "hasSpoiler": true
    }
  }'
```

## API Reference

### Base URL

```
http://localhost:8080/{BASE_PATH}/api/v1
```

*By default, `BASE_PATH` is unset, making the base URL `http://localhost:8080/api/v1`.*

If you set `BASE_PATH=custom-path`, the base URL becomes:

```
http://localhost:8080/custom-path/api/v1
```

### Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/post` | Bearer* | Publish content to a platform |
| POST | `/preview` | Bearer* | Validate and preview without publishing |
| GET | `/health` | Public | Health check |

*\* Auth is required ONLY if `AUTH_BEARER_TOKENS` environment variable is set.*

### POST /post

Publish content to a social media platform.

#### Request Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `platform` | string | Yes | Platform name (`telegram`) |
| `body` | string | No* | Post content (max length determined by `maxBody` or config default) |
| `account` | string | No* | Channel name from `config.yaml` |
| `channelId` | string \| number | No | Channel/chat ID (e.g., @mychannel, -100123456789, or 123456789 for Telegram). Accepts both string and number formats |
| `auth` | object | No* | Inline authentication credentials. See [Auth Field](#auth-field) below |
| `type` | string | No | Post type (default: `auto`). See [Post Types](#post-types) |
| `bodyFormat` | string | No | Body format: `text`, `html`, `md`, or platform-specific (e.g., `MarkdownV2`) (default: `text`) |
| `title` | string | No | Post title (platform-specific, max 1000 characters) |
| `description` | string | No | Post description (platform-specific, max 5000 characters) |
| `cover` | MediaInput | No | Cover image (object with `src` and optional `hasSpoiler`, max 500 characters for src) |
| `video` | MediaInput | No | Video file (object with `src` and optional `hasSpoiler`, max 500 characters for src) |
| `audio` | MediaInput | No | Audio file (object with `src`, max 500 characters) |
| `document` | MediaInput | No | Document file (object with `src`, max 500 characters) |
| `media` | MediaInput[] | No | Media array for albums (each object with `src` and optional `type`, `hasSpoiler`) |
| `options` | object | No | Platform-specific options (passed directly to platform API) |
| `disableNotification` | boolean | No | Send message silently (defaults to config value) |
| `tags` | string[] | No | Tags without # symbol. Passed as-is to supported platforms (max 200 items, each max 300 characters) |
| `scheduledAt` | string | No | Scheduled time (ISO 8601, max 50 characters) |
| `postLanguage` | string | No | Content language code. Passed as-is to supported platforms (max 50 characters) |
| `mode` | string | No | Mode: `publish`, `draft`. Only for supported platforms |
| `idempotencyKey` | string | No | Key to prevent duplicates (max 1000 characters) |
| `maxBody` | number | No | Override max body length from account config (max 500,000 characters). Takes priority over account's `maxBody` setting |

**Note:** Either `account` or `auth` must be provided. Either `body` or at least one media field (`cover`, `video`, `audio`, `document`, `media`) must be provided.

#### Auth Field

The `auth` field contains platform-specific authentication credentials. Its structure matches the `auth` section in `config.yaml`:

**For Telegram:**

```json
{
  "auth": {
    "apiKey": "123456789:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
  }
}
```

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `apiKey` | string | Yes | API key (for Telegram: bot token from @BotFather) |

In addition to the fields listed in the table, the `auth` object may contain **additional provider-specific fields**.

- All `auth` fields from config and request are **merged and passed to the provider as-is**
- Each provider is responsible for parsing and validating its own extra fields

**Auth Merging Behavior:**

- If `account` is provided, the base auth is taken from the account configuration in `config.yaml`
- If `auth` is also provided in the request, its fields **override** the channel's auth fields
- All auth fields in the request are optional - they only override specific fields from the channel config
- Final validation checks that all required fields for the platform are present after merging

**Examples:**

```json
// Use channel config entirely
{
  "platform": "telegram",
  "account": "company_telegram",
  "body": "Hello"
}

// Override only channelId (string format)
{
  "platform": "telegram",
  "account": "company_telegram",
  "channelId": "@different_channel",
  "body": "Hello"
}

// Provide complete inline auth (no channel)
{
  "platform": "telegram",
  "auth": {
    "apiKey": "123456789:ABC-DEF..."
  },
  "channelId": "@your_channel_username",
  "body": "Hello"
}
```

#### Post Types

| Type | Description |
|------|-------------|
| `auto` | Auto-detect from media fields (default) |
| `post` | Text message |
| `image` | Single image with caption |
| `video` | Video with caption |
| `audio` | Audio file with caption |
| `album` | Media group |
| `document` | Document/file |
| `article` | Long-form article |
| `short` | Short-form video |
| `story` | Story/status |
| `poll` | Poll |

#### MediaInput Format

Media fields accept only object format with `src` property and additional options:

```json
// Object with URL src
"cover": {
  "src": "https://example.com/image.jpg"
}

// Object with file_id src (Telegram)
"cover": {
  "src": "AgACAgIAAxkBAAIC..."
}

// Object with URL src and hasSpoiler
"cover": {
  "src": "https://example.com/image.jpg",
  "hasSpoiler": true
}

// Media array item with explicit type
"media": [
  {
    "src": "https://example.com/image.jpg",
    "type": "image"
  },
  {
    "src": "https://example.com/video.mp4",
    "type": "video"
  }
]
```

**Object properties:**

| Property | Type | Description |
|----------|------|-------------|
| `src` | string | Media source (URL or Telegram file_id, max 500 characters) - **required** |
| `hasSpoiler` | boolean | Hide under spoiler (optional) |
| `type` | string | Explicit media type: `image`, `video`, `audio`, `document` (optional, used in `media[]` arrays) |

**Notes:**
- `src` is **required** in all media fields
- `src` can be either a URL or a Telegram file_id
- URL and file_id strings have a maximum length of 500 characters
- The `type` property is only used in `media[]` arrays to override auto-detection by URL extension
- For single media fields (`cover`, `video`, `audio`, `document`) the `type` property is ignored
- For Telegram albums, `type` is mapped to supported types: `video` → `video`, others → `photo`

#### Success Response

**Status:** `200 OK`

```json
{
  "success": true,
  "data": {
    "postId": "123456",
    "url": "https://t.me/channel/123456",
    "platform": "telegram",
    "type": "post",
    "publishedAt": "2025-11-30T20:00:00.000Z",
    "raw": {
      "ok": true,
      "result": {
        "message_id": 123456,
        "chat": { "id": -1001234567890 },
        "date": 1701369600,
        "text": "Post content"
      }
    },
    "requestId": "uuid-v4"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `postId` | string | Platform-specific post ID |
| `url` | string | Public URL to the post (if available) |
| `platform` | string | Platform name |
| `type` | string | Actual post type used |
| `publishedAt` | string | Publication timestamp (ISO 8601) |
| `raw` | object | Raw response from platform API in format `{ok: true, result: {...}}` (matches Telegram Bot API structure) |
| `requestId` | string | Unique request identifier for tracking |

#### Error Response

**Status:** `200 OK`

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Error description",
    "details": {},
    "raw": {},
    "requestId": "uuid-v4"
  }
}
```

#### Error Codes

| Code | Description |
|------|-------------|
| `VALIDATION_ERROR` | Invalid request parameters |
| `AUTH_ERROR` | Authentication failed |
| `PLATFORM_ERROR` | Platform API error |
| `TIMEOUT_ERROR` | Request timed out (total operation limit or platform API timeout) |
| `NETWORK_ERROR` | Network connectivity issues (DNS failure, connection refused, etc.) |
| `RATE_LIMIT_ERROR` | Rate limit exceeded |
| `INTERNAL_ERROR` | Internal server error |

### POST /preview

Validate and preview content without publishing.

#### Request Body

Same as `/post`. The `idempotencyKey` field is ignored.

#### Success Response

**Status:** `200 OK`

```json
{
  "success": true,
  "data": {
    "valid": true,
    "detectedType": "post",
    "convertedBody": "# Hello\n\nThis is **bold**",
    "targetFormat": "md",
    "convertedBodyLength": 22,
    "warnings": []
  }
}
```

Note: For Telegram, no conversion is performed. `convertedBody` is the same as the input `body` and `targetFormat` reflects the requested `bodyFormat`.

#### Error Response

**Status:** `200 OK`

```json
{
  "success": false,
  "data": {
    "valid": false,
    "errors": ["Either 'account' or 'auth' must be provided"],
    "warnings": []
  }
}
```

### GET /health

Returns service health status.

**Response:**

```json
{
  "status": "ok"
}
```

### Telegram

#### Supported Types

| Type | API Method |
|------|------------|
| `post` | sendMessage |
| `image` | sendPhoto |
| `video` | sendVideo |
| `audio` | sendAudio |
| `document` | sendDocument |
| `album` | sendMediaGroup |

#### Auto Type Detection

When `type` is `auto` (default), the type is detected by priority:

| Priority | Field | Detected Type |
|----------|-------|---------------|
| 1 | `media[]` | `album` |
| 2 | `document` | `document` |
| 3 | `audio` | `audio` |
| 4 | `video` | `video` |
| 5 | `cover` | `image` |
| 6 | (none) | `post` |

**Note:** With `type: auto`, if multiple media fields are provided, the one with the highest priority is selected.
For Telegram, `cover` (priority 5) is considered low priority and cannot be combined with other media types (it will be ignored if higher priority media is present).
Other providers may allow combining `cover` with other media (e.g. video + cover).

#### Body Format Handling

The `bodyFormat` field specifies the format of the `body` content. For Telegram, the body is **sent as-is** without any conversion. The `bodyFormat` value is used to determine the appropriate `parse_mode` parameter for Telegram's API.

**Standard format mappings:**

| `bodyFormat` | Telegram `parse_mode` | Description |
|--------------|----------------------|-------------|
| `text` | *(not set)* | Plain text, no formatting |
| `html` | `HTML` | HTML formatting |
| `md` | `Markdown` | Markdown formatting |

**Custom format support:**

Any other `bodyFormat` value is passed directly as-is to the `parse_mode` parameter. This allows you to use platform-specific formats like Telegram's `MarkdownV2`:

| `bodyFormat` | Telegram `parse_mode` | Description |
|--------------|----------------------|-------------|
| `MarkdownV2` | `MarkdownV2` | Telegram's MarkdownV2 format (passed as-is) |
| *any other* | *passed as-is* | Custom value for the platform |

**Important Notes:**

- **No conversion is performed** - the body content you provide must already be in the format specified by `bodyFormat`
- **Options override** - If you specify `parse_mode` in the `options` field, it will **always override** the automatic mapping from `bodyFormat`

**Examples:**

```json
// Plain text (no formatting)
{
  "body": "Hello world",
  "bodyFormat": "text"
}

// HTML formatting
{
  "body": "<b>Hello</b> <i>world</i>",
  "bodyFormat": "html"
}

// Markdown formatting
{
  "body": "**Hello** _world_",
  "bodyFormat": "md"
}

// MarkdownV2 formatting - now can be specified directly in bodyFormat
{
  "body": "*Hello* _world_\\!",
  "bodyFormat": "MarkdownV2"
}

// Override bodyFormat with options.parse_mode
{
  "body": "*Hello* _world_\\!",
  "bodyFormat": "html",
  "options": {
    "parse_mode": "MarkdownV2"
  }
}
```

#### Platform Options

The `options` field accepts platform-specific parameters that are passed directly to the Telegram Bot API without transformation. Use the exact field names from the [Telegram Bot API documentation](https://core.telegram.org/bots/api).

Common options for Telegram account in `config.yaml`:

| Property | Type | Description |
|----------|------|-------------|
| `apiTimeoutSeconds` | number | Optional: API request timeout in seconds (passed to grammY). Default is 500. |
| `disableNotification` | boolean | Optional: Send messages silently by default. |

Common inline options in request:

```typescript
{
  "parse_mode": "HTML" | "Markdown" | "MarkdownV2",
  "disable_notification": boolean,
  "disable_web_page_preview": boolean,  // deprecated, use link_preview_options
  "link_preview_options": {
    "is_disabled": boolean,
    "url": string,
    "prefer_small_media": boolean,
    "prefer_large_media": boolean,
    "show_above_text": boolean
  },
  "protect_content": boolean,
  "reply_to_message_id": number,
  "reply_markup": {
    "inline_keyboard": [[{
      "text": string,
      "url"?: string,
      "callback_data"?: string,
      "web_app"?: { "url": string },
      // ... other button types
    }]]
  }
}
```

**Note:** If `parse_mode` or `disable_notification` are specified in `options`, they will override the values derived from `bodyFormat` or account configuration.

#### Telegram Limits

Telegram API enforces the following limits:

| Type | Limit |
|------|-------|
| Text message | 4096 characters |
| Caption | 1024 characters |
| Album items | Telegram limit: 2-10 files |
| File size (URL) | 50 MB |

**Note:** The microservice validates body length based on `maxBody` parameter. Priority order: request `maxBody` > account `maxBody`, with a hard service limit of 500,000 characters. Telegram's specific limits (4096 for text, 1024 for captions) are enforced by Telegram API itself.

#### Ignored Fields

These fields are not used by Telegram and will be ignored:

- `title`, `description`, `tags`, `postLanguage`, `mode`, `scheduledAt`

### More Examples

#### Audio

```bash
curl -X POST http://localhost:8080/api/v1/post \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "telegram",
    "account": "company_telegram",
    "body": "New podcast",
    "audio": {
      "src": "https://example.com/podcast.mp3"
    }
  }'
```

#### Document

```bash
curl -X POST http://localhost:8080/api/v1/post \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "telegram",
    "account": "company_telegram",
    "body": "Monthly report",
    "document": {
      "src": "https://example.com/report.pdf"
    }
  }'
```

#### Using file_id

```bash
curl -X POST http://localhost:8080/api/v1/post \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "telegram",
    "account": "company_telegram",
    "body": "Reposting video",
    "video": {
      "src": "BAACAgIAAxkBAAIC4mF9..."
    }
  }'
```

#### With Inline Keyboard

```bash
curl -X POST http://localhost:8080/api/v1/post \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "telegram",
    "account": "company_telegram",
    "body": "Check our website!",
    "options": {
      "reply_markup": {
        "inline_keyboard": [
          [{"text": "Visit", "url": "https://example.com"}],
          [{"text": "Contact", "callback_data": "contact"}]
        ]
      }
    }
  }'
```

#### With Inline Auth

```bash
curl -X POST http://localhost:8080/api/v1/post \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "telegram",
    "body": "Test post",
    "auth": {
      "apiKey": "123456:ABC..."
    },
    "channelId": "@your_channel_username"
  }'
```

#### Preview

```bash
curl -X POST http://localhost:8080/api/v1/preview \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "telegram",
    "account": "company_telegram",
    "body": "# Hello\n\nThis is **bold**",
    "bodyFormat": "md"
  }'
```

### Idempotency

When `idempotencyKey` is provided:

1. Key is combined with payload and hashed
2. Stored in in-memory cache with TTL (`idempotencyTtlMinutes`)
3. Duplicate requests within TTL:
   - If processing → returns a regular `200 OK` response with `success: false` and `error.code = VALIDATION_ERROR`
   - If completed → cached response returned

**Limitations:**

- Scoped to single instance
- Lost on restart

### Body Content Handling

**The microservice does not perform content conversion.** The `body` content is always sent as-is to the platform API.

The `bodyFormat` field is used only to specify the format of the content you're providing, which is then mapped to the appropriate platform-specific parameter (e.g., `parse_mode` for Telegram).

**Your responsibility:** Ensure that the `body` content is already formatted according to the `bodyFormat` you specify.

### Retry Logic

Automatic retries for transient errors:

- **Retryable:** Network timeouts, 5xx, rate limits
- **Non-retryable:** Validation errors, 4xx (except 429)
- **Formula:** `delay = retryDelayMs × random(0.8, 1.2) × attempt`

Configure in `config.yaml`:

```yaml
retryAttempts: 3
retryDelayMs: 1000
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | `development` | Environment mode |
| `LISTEN_HOST` | `0.0.0.0` | Server bind address |
| `LISTEN_PORT` | `8080` | Server port |
| `BASE_PATH` | (none) | Base path for the application (API will be at `{BASE_PATH}/api/v1`) |
| `LOG_LEVEL` | `warn` | Logging level |
| `AUTH_BEARER_TOKENS` | (none) | Comma-separated list of allowed Bearer tokens for API authentication. If not set, authentication is disabled. |
| `CONFIG_PATH` | `./config.yaml` | Path to config file |

### Config File (`config.yaml`)

```yaml
# Request timeout (seconds)
# Total time limit for processing a request, including all retries and platform delays
requestTimeoutSecs: 60
retryAttempts: 3
retryDelayMs: 1000
idempotencyTtlMinutes: 10
accounts:
  company_telegram:
    platform: telegram
    auth:
      apiKey: ${MY_TELEGRAM_TOKEN}
    channelId: "@your_channel_username"
    maxBody: 100000  # Optional: account-specific limit; request maxBody can override it (up to hard limit 500000)
```

### Limits

- **Request timeout**
  - Config field: `requestTimeoutSecs`
  - Range: **1–600 seconds** (up to 10 minutes)
  - Applied to the whole processing of a request, including retries and platform API calls.

- **Body length**
  - Hard service limit: **500,000 characters** (cannot be exceeded).
  - Effective limit is calculated as:
    - Request `maxBody` (if provided) →
    - otherwise account `maxBody` from `config.yaml` (if provided) →
    - otherwise the hard service limit `500000`.
  - If the body is longer than the effective limit, validation fails with a `VALIDATION_ERROR`.

### Graceful Shutdown

The service implements graceful shutdown to ensure in-flight requests complete properly when receiving termination signals.

#### Behavior

When the service receives `SIGTERM` or `SIGINT`:

1. **New connections are rejected** — Returns `503 Service Unavailable` for new requests
2. **In-flight requests continue** — Active requests are allowed to complete
3. **Timeout enforcement** — Maximum wait time is **30 seconds** (hardcoded constant)
4. **Forced termination** — After timeout, the process exits even if requests are still active

#### Configuration

- **Shutdown timeout**: `30 seconds` (global constant in `src/app.constants.ts`)
- **Fastify settings**:
  - `forceCloseConnections: 'idle'` — Closes idle connections during shutdown
  - `connectionTimeout: 60s` — Maximum time for establishing connections
  - `requestTimeout: 10m` — Maximum time for processing requests

#### Docker

When running in Docker, ensure `stop_grace_period` in `docker-compose.yml` is **greater than or equal to** the shutdown timeout:

```yaml
services:
  microservice:
    stop_grace_period: 30s  # Must be >= GRACEFUL_SHUTDOWN_TIMEOUT_MS
```

If `stop_grace_period` is less than the shutdown timeout, Docker will forcefully kill the container before graceful shutdown completes.

## Library Mode

The project can be used as a standalone TypeScript library in other applications.

### Introduction

In library mode, the service runs without a NestJS HTTP server (Fastify). It provides a programmatic API to validate and publish content to various social media platforms.

Key features of library mode:
- **Full Isolation**: Uses only provided configuration. No environment variables are read.
- **Standalone DI**: Initialized manually without the overhead of a full NestJS application.
- **Standard API**: The same business logic as used in microservice mode.
- **Custom Logging**: Inject your own logger implementation.

### Installation

```bash
npm install bozonx-social-media-posting
# or
pnpm add bozonx-social-media-posting
```

### Quick Start

```typescript
import { createPostingClient } from 'bozonx-social-media-posting';

const client = createPostingClient({
  accounts: {
    marketing: {
      platform: 'telegram',
      auth: {
        apiKey: 'YOUR_BOT_TOKEN'
      },
      channelId: '@your_channel_username'
    }
  }
});

const result = await client.post({
  account: 'marketing',
  platform: 'telegram',
  body: 'Hello from library mode!'
});

console.log(result);

await client.destroy();
```

### Library Configuration

The `createPostingClient` function accepts a `LibraryConfig` object.

#### Properties

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `accounts` | `Record<string, AccountConfig>` | **Required** | Dictionary of named accounts. |
| `requestTimeoutSecs` | `number` | `60` | Total timeout for a single post/preview operation. |
| `retryAttempts` | `number` | `3` | Number of automatic retry attempts for transient errors. |
| `retryDelayMs` | `number` | `1000` | Base delay between retries. |
| `idempotencyTtlMinutes` | `number` | `10` | How long to keep idempotency records in memory. |
| `logLevel` | `'debug' \| 'info' \| 'warn' \| 'error'` | `'warn'` | Logging verbosity for the default console logger. |
| `logger` | `ILogger` | `ConsoleLogger` | Custom logger implementation. |

#### Account Configuration

Each account must follow the `AccountConfig` interface:
- `platform`: `'telegram'` (more coming soon)
- `auth`: Platform-specific authentication (e.g., `{ apiKey: string }` for Telegram)
- `channelId`: Target identifier (e.g., `@channel` or numeric ID)
- `maxBody`: (Optional) Limit for body length.

### Library API Reference

#### `client.post(request, abortSignal?)`

Publishes content to the specified account.

**Parameters:**
- `request`: PostRequestDto
- `abortSignal`: (Optional) Standard `AbortSignal` to cancel the request.

**Returns:** 
A promise that resolves to either success data or an error object. It **does not throw** for business/platform errors.

#### `client.preview(request)`

Validates the request without publishing.

**Parameters:**
- `request`: PostRequestDto

**Returns:**
A promise resolving to a preview result including `detectedType`, `convertedBody`, and any `warnings`.

Note: For Telegram, `convertedBody` is currently the same as the input `body` (no conversion). The `bodyFormat` is mapped to Telegram `parse_mode` during publishing; preview exposes this via `targetFormat`.

#### `client.destroy()`

Gracefully shuts down the client, cleaning up any timers or internal resources. Always call this when finished or on application shutdown.

### Custom Logger

You can provide your own logger by implementing the `ILogger` interface:

```typescript
import { ILogger, createPostingClient } from 'bozonx-social-media-posting';

class MyLogger implements ILogger {
  debug(msg: string, ctx?: string) { /* ... */ }
  log(msg: string, ctx?: string) { /* ... */ }
  warn(msg: string, ctx?: string) { /* ... */ }
  error(msg: string, trace?: string, ctx?: string) { /* ... */ }
}

const client = createPostingClient({
  accounts: { ... },
  logger: new MyLogger()
});
```

### Isolation and Environment

When used as a library, the package is strictly isolated:
1. **No `process.env`**: It will NOT attempt to read `BOT_TOKEN` or any other environment variables. All secrets must be passed explicitly in the `accounts` configuration.
2. **No Config Files**: It will NOT try to load `config.yaml`.
3. **Instance Isolation**: You can create multiple clients with different configurations in the same process; they will not interfere with each other.

### Best Practices

1. **Re-use Client**: Create one client instance and reuse it for multiple posts.
2. **Idempotency**: Always provide an `idempotencyKey` in your post requests to prevent duplicate posts during retries or network issues.
3. **Graceful Shutdown**: Ensure `client.destroy()` is called to avoid memory leaks or hanging processes.
4. **Error Handling**: Check the `success` field in the response.

```typescript
const result = await client.post(request);
if (result.success) {
  // Use result.data
} else {
  // Handle result.error
}
```

## Development

### Requirements

- Node.js 24 (see `.nvmrc`)
- pnpm 11.22.0

### Quick Start (Development)

```bash
# 1) Install dependencies
pnpm install

# 2) Environment (dev)
cp .env.example .env

# 3) Run in development mode (watch)
pnpm dev
```

- Default URL (dev): `http://localhost:8080/api/v1`

### Tests

Jest projects are separated into `unit` and `e2e`.

```bash
# All tests
pnpm test

# Unit tests
pnpm test:unit

# E2E tests
pnpm test:e2e

# Watch mode
pnpm test:watch

# Coverage
pnpm test:cov

# Debug
pnpm test:unit:debug
pnpm test:e2e:debug
```

### Code Quality

```bash
# Lint
pnpm lint

# Format
pnpm format
```

### Build

```bash
# Build the application
pnpm build

# Build library mode
pnpm build:lib
```

### Useful to Know

- Global `ValidationPipe` is enabled (whitelist, forbidNonWhitelisted, transform).
- In dev, `pino-pretty` is used with more detailed logs.
- In prod, auto-logging of `/health` is ignored; in dev — it's logged.
- Sensitive headers are redacted in logs (`authorization`, `x-api-key`).
- TypeScript/Jest path aliases: `@/*`, `@common/*`, `@modules/*`, `@config/*`, `@test/*`.

## Docker

```bash
# Run the prebuilt image (recommended)
docker compose -f docker/docker-compose.yml up -d

# Or build a local image
docker build -t social-posting:latest -f docker/Dockerfile .
```

## License

MIT
