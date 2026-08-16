# Development

pnpm workspace. Published packages in `packages/*`, deployables in `apps/*`, runnable examples in
`examples/*`.

```bash
pnpm install
cp .env.example .env
pnpm build
```

## The loop

```bash
pnpm test             # every package, on Node
pnpm test:watch
pnpm check            # typecheck, lint, format, unit tests — what CI runs
pnpm test:e2e         # the HTTP shell end to end
```

## Before submitting

```bash
pnpm check
pnpm test:e2e
pnpm test:workerd     # every published package, inside workerd
pnpm check:deps       # no runtime dependencies in published packages
pnpm check:publish    # publint and are-the-types-wrong
```

`pnpm test:workerd` is not optional when touching `packages/**`: it is what catches a Node built-in
arriving through a transitive dependency, which lint cannot see.

## Adding a network

```bash
pnpm platform mastodon
```

Then read [CONTRIBUTING-PLATFORMS.md](../CONTRIBUTING-PLATFORMS.md).

## Running the shell

```bash
pnpm --filter @bozonx/social-posting-server build
pnpm --filter @bozonx/social-posting-server start
```
