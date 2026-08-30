# `@bozonx/social-posting-mastodon`

Web-standard Mastodon API adapter with no runtime dependencies. It publishes statuses, media,
polls, replies and explicit threads, sends alt text and `Idempotency-Key`, and discovers each
instance's limits through `/api/v2/instance`.

The package exports `mastodon` and `pixelfed`. Pixelfed is a descriptor-derived module sharing
the exact Mastodon protocol implementation; it requires media and declares only confirmed flows.
Every account must set its HTTPS `apiBaseUrl` and an OAuth access token with `write:statuses` and
`write:media`. OAuth client registration is instance-specific and remains a host responsibility.

Truth Social is deliberately not exported until automated publishing is confirmed to comply with
its terms. Its catalog entry remains `restricted`.
