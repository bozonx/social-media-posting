# Agent Rules (alwaysApply)

## Project overview

- Web-standard TypeScript library for publishing across social networks, plus an optional stateless HTTP shell (`apps/server`) for non-Node consumers.
- Node.js version: see `.nvmrc` (>=24). It must agree with `package.json#engines.node`.
- Package manager: `pnpm`, version pinned in `package.json#packageManager`.

### Layout

- pnpm workspace:
  - Published packages in `packages/*` (`@bozonx/social-posting`, `@bozonx/social-posting-*`, `@bozonx/social-posting-conformance`).
  - Deployable HTTP shell in `apps/*` (`apps/server`).
  - Runnable examples in `examples/*`.
- Each package keeps its sources in `src/` and its tests in `test/`.
- Shared test setup: `test/setup/`.
- Guides: `docs/`. Development notes: `dev_docs/`.
- Docker: `apps/server/docker/Dockerfile` and `apps/server/docker/docker-compose.yml`; the build context is the repository root.

### Core invariants & architecture

- **Library-first:** The primary product is the library. The HTTP shell (`apps/server`) is a deployment artefact for non-Node consumers and is never published to npm.
- **Zero runtime dependencies:** `packages/core` (`@bozonx/social-posting`) and every `packages/platform-*` must maintain empty `dependencies`. Vendor SDKs are banned; use direct HTTP API calls via `fetch`. Checked by `pnpm check:deps`.
- **Web standards runtime:** Published packages target web standards (`fetch`, `Request`/`Response`, WHATWG streams, Web Crypto). Node built-ins are banned in packages by ESLint, and the test suite runs under `workerd` (`pnpm test:workerd`).
- **Stateless core:** The core owns no durable state: no retries beyond a single attempt, no idempotency storage, no rate limiting. Those concerns belong to the host application.
- **Configuration:** `apps/server/config.yaml` is the platform/account configuration source for Node (mounted read-only) or `CONFIG_JSON` for Cloudflare Workers.
- **Entry points:**
  - Library: `packages/core/src/index.ts`
  - HTTP shell (Node): `apps/server/src/entry/node.ts`
  - HTTP shell (Workers): `apps/server/src/entry/worker.ts`

### Practices & workflows

- **Environment variables:** `.env.example` is the source of truth. There is exactly one other env file, `.env`, and it is git-ignored and for local development only.
- **Verification:** Run `pnpm check` (typecheck, lint, format check, unit tests). When touching packages, also verify `pnpm test:workerd`, `pnpm check:deps`, `pnpm check:publish`, and `pnpm test:e2e`.
- **Dependencies:** Dependency ranges use caret (`^`). Never pin an exact version in package manifests.
- **Changelog:** Update `docs/CHANGELOG.md` for significant changes.
- **Language:** README, documentation, JSDoc, log messages, and user-facing strings are written in English.
- **No legacy shims:** Do not leave transitional shims, deprecated aliases or compatibility fallbacks behind. When something is renamed or replaced, remove the old form in the same change.
