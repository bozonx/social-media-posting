# Platform capability sources

Runtime capability descriptors live with platform adapters. Future and restricted integrations
are tracked by `@bozonx/social-posting-platform-catalog`. A catalog profile is validation data,
not proof that a publishing adapter is installed.

Each blocking value must cite official documentation through `capabilities.sources`. Values that
are account-, instance-, subreddit-, or partner-specific stay out of static limits and are
discovered at runtime through `IPlatform.resolveCapabilities()`.

A descriptor that cannot state a value states nothing. The catalogue used to carry a "generic
media" block — every source kind, for every network — which read at the call site exactly like a
verified limit. Those blocks are gone: a profile now declares media only where the cited source
says who moves the bytes (`transport`), and Facebook, Snapchat, Reddit, Twitch and Kwai carry no
media block at all.

## Runtime capabilities

`resolveCapabilities(account)` returns what a network says about _this_ account, plus
`cacheableForSecs`. The library never caches it: it hands the reading back and the host decides
whether it goes in Redis, in a column, or nowhere. `cacheableForSecs: 0` — TikTok's Creator Info —
means fetch before every publication.

The merge is one implementation in the core (`mergeCapabilities`), not one per adapter:

- a runtime scalar overrides the static one;
- a runtime list replaces the static list whole — a network that narrows its accepted MIME types
  means exactly those;
- anything the runtime does not mention keeps its static value.

Pass the result to `post()` or `preview()` as `options.capabilities`; without it both fall back to
the static descriptor, and a per-account limit will be previewed optimistically.

## Quotas

`rateLimits.quotaCost` states what one publication costs where a network bills in its own units
(YouTube spends quota units against a daily budget), and `quotaKind` says what is counted:
`operations`, `storage` or `rollingWindow`. Where the network has an endpoint that reports the
remainder — Vimeo's storage, Instagram's publishing window — the adapter implements `getQuota()`
and the host reads it through `client.getQuota()`.

| Profile           | Public publishing API | Important qualification                                              |
| ----------------- | --------------------- | -------------------------------------------------------------------- |
| Facebook          | Available             | Page publishing requires Page access and permissions.                |
| Threads           | Available             | Container-based publishing and app permissions apply.                |
| Instagram         | Available             | Professional accounts, public media URLs, and rolling publish quota. |
| WhatsApp Channels | Unavailable           | No documented public Cloud API for Channel updates.                  |
| YouTube           | Available             | Upload quota and audit restrictions apply.                           |
| Vimeo             | Available             | Upload access and account storage quota apply.                       |
| TikTok            | Restricted            | Direct posting requires review and creator controls.                 |
| Mastodon          | Available             | Limits are instance configuration and require discovery.             |
| X                 | Available             | Product tier and weighted character counting apply.                  |
| Bluesky           | Available             | AT Protocol record and blob constraints apply.                       |
| Snapchat          | Restricted            | Public Profile API access is approval-based.                         |
| Discord           | Available             | Bot/webhook permissions and guild upload tier apply.                 |
| Pinterest         | Available             | Pins require a board and media-specific flows.                       |
| LinkedIn          | Restricted            | Publishing products and scopes require approval.                     |
| Reddit            | Available             | Subreddit requirements must be fetched before submit.                |
| Twitch            | Restricted            | No general-purpose social post upload endpoint.                      |
| Kwai              | Restricted            | Access and documentation vary by partner program and region.         |
| Dailymotion       | Available             | Video upload and account quota apply.                                |

## Monitoring contract

An automated monitor may propose changes, but it must not mutate runtime limits directly. It
should compare official sources with the descriptor, update `verifiedAt`, attach evidence, and
open a reviewed change with validation fixtures. Removed or inaccessible documentation is a
warning, not permission to replace a value with an unofficial blog claim.
