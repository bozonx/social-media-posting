# Changelog

## Unreleased

- Upgraded `class-validator` to 0.15.1 after validating custom validators and request DTOs.
- Split CI validation from tag-only multi-architecture image releases and aligned the fleet-wide
  Renovate policy.
- Standardized fleet scripts, environment handling, service identity, draining health checks,
  non-root multi-stage Docker build, Compose limits, flat ESLint and Renovate configuration.

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Bearer Token Authentication**:
  - Optional API authentication using `AUTH_BEARER_TOKENS` environment variable.
  - Supports multiple comma-separated tokens.
  - Global `BearerAuthGuard` with `@Public()` decorator support for bypassing auth.
- **Library Mode**: Support for using the package as a standalone TypeScript library.
  - `createPostingClient`: New entry point for programmatic usage without NestJS HTTP server.
  - Full configuration isolation (no environment variables or external YAML files read).
  - Explicit exports for services, DTOs, and types.
- **Customizable Logging**:
  - `ILogger` interface for injecting custom logger implementations.
  - `ConsoleLogger` with configurable log levels.
- **Automatic Type Detection (`type: auto`)**: New default post type that automatically determines the Telegram API method based on provided media fields
  - Priority order: `media[]` → `document` → `audio` → `video` → `cover` → text message
  - Validation for ambiguous media fields (multiple conflicting media types)

- **New Media Fields**:
  - `audio` - Audio file support (MP3, M4A, OGG) via `sendAudio`
  - `document` - Document/file support (any file type) via `sendDocument`

- **MediaInput Type**: Media field format supporting:
  - Object with options: `{ "src": "...", "hasSpoiler": true, "type": "image" }`
  - `src` - URL or Telegram file_id for reusing previously uploaded files
  - `hasSpoiler` - Hide media under spoiler animation (for sensitive content)
  - `type` - Explicit media type for albums (image, video, audio, document)

- **New Services**:
  - `TelegramTypeDetector` - Service for automatic type detection based on media fields
  - `AmbiguousMediaValidator` - Validator for detecting conflicting media fields

- **Validation Improvements**:
  - Required field validation for explicit types
  - Warning logs for ignored fields (title, description, tags, etc.)

- **Unit Tests**: Comprehensive test coverage (195 tests)
  - `TelegramProvider` tests (38 tests)
  - `TelegramTypeDetector` tests (16 tests)
  - `AmbiguousMediaValidator` tests (12 tests)
  - `MediaInputHelper` tests (28 tests)
  - `MediaInputValidator` tests (20 tests)

- **Idempotency Support**:
  - Best-effort idempotency with `idempotencyKey`
  - In-memory cache per instance with configurable TTL (`common.idempotencyTtlMinutes`)
  - Cached reuse of both successful and error responses for identical requests

- **Preview Endpoint (`POST /preview`)**:
  - Validate request parameters without publishing
  - Preview body conversion (markdown → HTML, etc.)
  - Get warnings about ignored fields and length limits
  - Returns `detectedType`, `convertedBody`, `targetFormat`, `convertedBodyLength`, `warnings`

### Changed

- **`maxBody` Configuration Refactoring**:
  - Added `maxBody` parameter to account configuration (optional, per-account limit)
  - Request `maxBody` overrides account's `maxBody`
  - Introduced a hard service limit of 500,000 characters for body length (not configurable)

- **Media Validation Refactoring**:
  - Replaced strict validation errors for multiple media fields with soft priority-based logic
  - Priority order: `media[]` (1) → `document` (2) → `audio` (3) → `video` (4)
  - For Telegram: `cover` (priority 5) is ignored if higher priority media is present (instead of throwing error)
  - `AmbiguousMediaValidator` renamed to `MediaPriorityValidator`

- Default `type` changed from `post` to `auto`
- Media fields (`cover`, `video`, `media[]`) now accept `MediaInput` type instead of plain strings
- `TelegramProvider.supportedTypes` now includes `AUTO` and `AUDIO`
- Telegram-specific limits (text length, album size) are now delegated to the Telegram API instead of being validated by the microservice
- **Response format for `raw` field**: Now returns `{ok: true, result: {...}}` format to match standard Telegram Bot API and n8n Telegram node behavior (previously returned only the `result` content)

### Fixed

- Import paths in `TelegramTypeDetector` service
- DI registration for `TelegramTypeDetector` in `ProvidersModule`
- **TypeError in `buildPostUrl`**: Fixed `chatId.startsWith is not a function` error when `chatId` is passed as a number instead of string (e.g., from n8n or YAML config)
- **Library Mode Platform Registration**: Fixed bug where platforms were not being registered when using `createPostingClient()`, causing "Platform not supported" errors. Now properly instantiates and registers TelegramPlatform and TelegramAuthValidator with their dependencies.

---

## [0.1.0] - 2025-11-30

### Added

- Initial MVP release
- Telegram provider with support for:
  - Text posts (`sendMessage`)
  - Images (`sendPhoto`)
  - Videos (`sendVideo`)
  - Albums (`sendMediaGroup`)
  - Documents (`sendDocument`)
- Content conversion (HTML ↔ Markdown ↔ Text)
- Media URL validation
- Retry logic with ±20% jitter
- YAML configuration with environment variable substitution
- Platform-specific options support
- Health check endpoint
