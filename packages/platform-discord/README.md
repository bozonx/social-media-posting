# @bozonx/social-posting-discord

Discord support for [`@bozonx/social-posting`](https://www.npmjs.com/package/@bozonx/social-posting).
Zero runtime dependencies, Web APIs only — it runs on Node, Bun, Deno and Cloudflare Workers.

```bash
pnpm add @bozonx/social-posting @bozonx/social-posting-discord
```

```ts
import { createPostingClient } from '@bozonx/social-posting';
import { discord } from '@bozonx/social-posting-discord';

const client = createPostingClient({
  platforms: [discord],
  accounts: {
    announcements: {
      platform: 'discord',
      auth: { webhookUrl: process.env.DISCORD_WEBHOOK_URL },
    },
  },
});

await client.post({ platform: 'discord', account: 'announcements', body: 'Ship it.' });
```

## Two access models, and why the difference matters

Discord is the only network in this set where the credential and the destination can be the same
string. Pick one per account; an account carrying both is refused rather than guessed at.

|                               | `webhookUrl`                                                    | `botToken`                                                                                 |
| ----------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Setup                         | Server settings → Integrations. No OAuth, no app review.        | A registered application, invited to the server with `Send Messages` (and `Attach Files`). |
| Destination                   | **Baked into the URL.** No `target` needed.                     | `target.id` is the channel id, and it is required.                                         |
| Replies                       | No.                                                             | Yes, via `inReplyTo`.                                                                      |
| Name and avatar               | Overridable per message (`extra.username`, `extra.avatar_url`). | Fixed, the bot's own.                                                                      |
| Deletes its own messages      | Yes, through the webhook token.                                 | Yes, by channel and message id.                                                            |
| Reads the server's boost tier | No — keeps the unboosted attachment limit.                      | Yes, through `resolveCapabilities()`.                                                      |

**A webhook URL is a secret, not a channel id.** Anyone holding it can post to that channel.
Store it the way you store a token, never in a column named `channelId`.

## Addressing

The channel is `target.id`. Two further parts are declared in `capabilities.targetSchema`:

```ts
target: {
  id: '1290000000000000002',      // channel id
  guildId: '1280000000000000003', // server: used for permalinks and boost-tier limits
  threadId: '1295000000000000007' // optional: post into a thread of that channel
}
```

A scalar `target` is accepted as shorthand for `{ id }`, but then no permalink can be built:
Discord message URLs contain the server id.

## What it publishes

| Type                                  | Support                                                           |
| ------------------------------------- | ----------------------------------------------------------------- |
| `post`                                | Up to 2 000 characters, Discord-flavoured Markdown.               |
| `image`, `video`, `audio`, `document` | One attachment, uploaded as `multipart/form-data`.                |
| `album`                               | Up to 10 attachments of any mix.                                  |
| `poll`                                | Native poll: `title` is the question, `poll.options` the answers. |

Not supported, because Discord has no such product: `shortVideo`, `story`, `article`, scheduling
and drafts. A vertical video is an ordinary attachment.

### Media

Discord never fetches a URL — every file is uploaded to it. A `url` source still works: this
adapter downloads it first, which is why the declared transport is `both`. The URL therefore has
to be reachable from **your** process, not from Discord, and no signed-URL lifetime requirement
applies.

Set `sensitive: true` on a media item to spoiler it. Discord has no flag for this: the adapter
prefixes the file name with `SPOILER_`, which is the mechanism Discord actually uses.
`altText` becomes the attachment description (max 1 024 characters).

### Attachment size is a property of the server

The shipped descriptor states the **unboosted** ceiling of 10 MiB. The real ceiling rises with the
server's boost tier, so a bot-token account should ask before publishing:

```ts
const resolved = await platform.resolveCapabilities(accountConfig);
// resolved.capabilities.media.video.maxBytes  → 10 / 50 / 100 MiB by boost tier
// resolved.cacheableForSecs                   → 3600
```

The library caches nothing: it hands the reading back with a lifetime and your host decides where
it lives. A webhook account cannot read the server and keeps the floor.

## Platform options (`extra`)

`embeds`, `tts`, `flags`, `allowed_mentions`, `components`, plus `username` and `avatar_url` for
webhook accounts only. Keys the adapter builds itself — `content`, `attachments`, `poll`,
`message_reference` — are refused rather than silently overwritten.

## Errors

| Code               | When                                                                     |
| ------------------ | ------------------------------------------------------------------------ |
| `RATE_LIMIT_ERROR` | 429, carrying Discord's own `retry_after` as `retryAfterMs`.             |
| `AUTH_ERROR`       | 401 (token rejected) and 403 (the bot lacks permission in this channel). |
| `VALIDATION_ERROR` | Unknown channel or deleted webhook (404), and malformed requests.        |
| `CONTENT_REJECTED` | An attachment or embed Discord refuses (400 with code 50035, 413).       |
| `PLATFORM_ERROR`   | 5xx, retryable.                                                          |

Publishing is a single call, so there is no resume handle and no `processing` state.

## A product note

Discord is an announcement channel, not a social network. There are no impressions, no reach and
no post analytics behind a message. Label it accordingly in your UI, or users will expect numbers
that do not exist.

## Sources

- [Create Message](https://docs.discord.com/developers/resources/message#create-message)
- [Execute Webhook](https://docs.discord.com/developers/resources/webhook#execute-webhook)
- [Uploading files](https://docs.discord.com/developers/reference#uploading-files)

## License

MIT
