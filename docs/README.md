# Documentation map

This directory is the entry point for both people and automated agents. The documentation is
organized by question rather than by package. When prose and runtime data disagree, the exported
TypeScript types and the registered platform's capability descriptor are authoritative.

## Start here

| You need to…                                                | Read                                                           |
| ----------------------------------------------------------- | -------------------------------------------------------------- |
| Publish from a TypeScript application                       | [Using the library](USING-THE-LIBRARY.md)                      |
| Decide whether a request works on a network                 | [Platform guide](PLATFORM-SPECIFICS.md) and the package README |
| Build forms or validate before publishing                   | [Capability sources](PLATFORM-CAPABILITIES.md)                 |
| Implement retries, status polling, and duplicate protection | [Delivery semantics](DELIVERY-SEMANTICS.md)                    |
| Store and refresh credentials                               | [OAuth and credentials](OAUTH.md)                              |
| Choose Node, Workers, Deno, or Bun                          | [Runtimes](RUNTIMES.md)                                        |
| Call the stateless HTTP shell                               | [Server README](../apps/server/README.md)                      |
| Deploy that shell                                           | [Deployment](deploy.md)                                        |
| Add an adapter                                              | [Platform contribution guide](../CONTRIBUTING-PLATFORMS.md)    |
| Work on this repository                                     | [Development](dev.md)                                          |

The root [README](../README.md) is the short product overview. The core
[package README](../packages/core/README.md) is the compact API reference. Adapter READMEs contain
credential fields, examples, upload flows, and platform options for one network.

## Source-of-truth order

Use this order when answering a question or generating an integration:

1. `client.resolveCapabilities(request)` for account- or instance-specific facts that can change.
2. `client.getCapabilities(platform)` for the installed adapter's static contract.
3. Exported TypeScript types for request and response shapes.
4. The adapter package README for operational explanation and examples.
5. These cross-platform guides for design rules and comparisons.
6. `@bozonx/social-posting-platform-catalog` only for future, restricted, or unavailable
   integrations. A catalog record is not proof that an adapter is installed.

Never infer support from a social network's consumer UI. A product feature can exist without a
public publishing endpoint (LinkedIn Articles and WhatsApp Channels are examples). Never copy a
limit from this prose into application logic when the capability descriptor exposes it.

## Stable integration rules

- One `post()` call is one attempt. The host owns retries, queues, rate limiting, and idempotency
  storage.
- Call `preview()` before enqueueing when user input can be corrected. Use its `adaptedRequest`,
  issues, warnings, and required media URL lifetime.
- Persist the complete successful `ref`, not only `postId`.
- Persist an error's `resumeHandle` before scheduling another attempt.
- Persist a successful `processing` handle and call `checkStatus()` on the host's schedule.
- Treat `UNKNOWN_OUTCOME` as “the post may exist”; do not blindly publish again.
- Use explicit `type` for `shortVideo`, `story`, `article`, and other product-level formats.
- Namespace platform settings in `extra`; do not let them overwrite normalized request fields.
- Supply public, sufficiently long-lived URLs to pull-based platforms. A URL accepted as input
  does not necessarily mean the platform fetches it itself.
- Persist rotated OAuth credentials through `CredentialProvider.onCredentialsRefreshed()`.

## Maintenance contract

Documentation, JSDoc, examples, log messages, and user-facing strings are written in English.
Significant public changes also update [the changelog](CHANGELOG.md). When an adapter changes,
update its capability descriptor first, then its package README and any affected comparison in
this directory. Do not leave old aliases or compatibility instructions behind.
