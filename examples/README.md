# Examples

Both are real workspace packages with tests that run in CI, so they cannot drift from the library.

## `embedded/`

The minimal in-process consumer: build a client, hand it the networks it should serve, preview,
publish. Its tests assert the properties a library must have to be embeddable — two clients in one
process stay independent, and nothing writes to the host's console or to any ambient logger.

```bash
pnpm --filter @bozonx/example-embedded start
```

## `custom-platform/`

A complete social network implemented **outside** the library, in one file. Nothing in
`@bozonx/social-posting` knows it exists, and it imports nothing private. It is the proof that the
extension seam works from the outside rather than only from within this repository — capabilities,
credential validation and error classification all behave exactly as they do for a built-in
network.

```bash
pnpm --filter @bozonx/example-custom-platform start
```

Writing a real one: [`CONTRIBUTING-PLATFORMS.md`](../CONTRIBUTING-PLATFORMS.md).
