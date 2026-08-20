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
pnpm check            # static analysis only (typecheck, lint, format check)
pnpm validate         # check + unit tests — what you run before calling work finished
```

## Before submitting

```bash
pnpm changeset        # declare version bump & changelog message for touched packages
pnpm validate:all     # full verification — static analysis, deps, build, strict types, unit, e2e, workerd, publish checks (what CI runs)
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
