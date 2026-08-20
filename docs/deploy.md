# Deployment

Two artefacts, one source.

## Docker (Node)

```bash
pnpm docker:build
pnpm docker:up
```

The image builds from the workspace root, runs as the unprivileged `node` user, and mounts
`apps/server/config.yaml` read-only. Compose sets init, a graceful stop period, health checks, log
rotation and a memory limit.

Supply secrets through environment variables that `config.yaml` references as `${VAR}`. Never write
a token into the YAML file or bake one into the image.

## Cloudflare Workers

```bash
cd apps/server
wrangler secret put CONFIG_JSON          # the same structure as config.yaml, as JSON
wrangler secret put AUTH_BEARER_TOKENS
pnpm deploy:worker
```

A Worker has no filesystem, so configuration arrives as JSON in a secret rather than as a file.
What a Workers deployment can and cannot publish is in [RUNTIMES.md](RUNTIMES.md) — text, links and
media fetched by URL are fine; a large chunked video upload needs the Node deployment.

## Releasing

Releases are managed with [Changesets](https://github.com/changesets/changesets):

1. Whenever changes are made to packages, create a changeset:
   ```bash
   pnpm changeset
   ```
2. Merge the changes into `main`. GitHub Actions will automatically open or update the **chore: version packages** PR.
3. Review and merge the PR. The release workflow will automatically:
   - Validate the entire workspace (`pnpm validate:all`)
   - Publish packages to npm with provenance
   - Push git tags and create GitHub releases
   - Build and push multi-architecture Docker images (`linux/amd64`, `linux/arm64`) to GHCR
