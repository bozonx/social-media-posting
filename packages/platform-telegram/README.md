# @bozonx/social-posting-telegram

Telegram Bot API support for [`@bozonx/social-posting`](https://www.npmjs.com/package/@bozonx/social-posting).

Talks to the Bot API over plain `fetch` — no SDK, no dependencies — so it runs unchanged on Node,
Cloudflare Workers, Deno and Bun.

```bash
pnpm add @bozonx/social-posting @bozonx/social-posting-telegram
```

```ts
import { createPostingClient } from '@bozonx/social-posting';
import { telegram } from '@bozonx/social-posting-telegram';

const client = createPostingClient({
  accounts: {
    myChannel: {
      platform: 'telegram',
      auth: { apiKey: process.env.TELEGRAM_BOT_TOKEN! },
      channelId: '@my_channel',
    },
  },
  platforms: [telegram],
});
```

## Account configuration

| Field                 | Type             | Meaning                                            |
| --------------------- | ---------------- | -------------------------------------------------- |
| `auth.apiKey`         | string           | Bot token, `123456789:ABC-DEF…`                    |
| `channelId`           | string \| number | `@channel`, `-1001234567890`, or a numeric chat id |
| `disableNotification` | boolean          | Send silently by default                           |
| `apiTimeoutSeconds`   | number           | Per-call Bot API timeout                           |
| `maxBody`             | number           | A stricter body limit than Telegram's own          |

The target chat is resolved from `request.channelId`, then the account's `channelId`.

## Post types

| Type       | Bot API method   |
| ---------- | ---------------- |
| `post`     | `sendMessage`    |
| `image`    | `sendPhoto`      |
| `video`    | `sendVideo`      |
| `audio`    | `sendAudio`      |
| `document` | `sendDocument`   |
| `album`    | `sendMediaGroup` |

### Automatic detection

With `type` omitted or `auto`, the first field present decides:

| Priority | Field      | Type       |
| -------- | ---------- | ---------- |
| 1        | `media[]`  | `album`    |
| 2        | `document` | `document` |
| 3        | `audio`    | `audio`    |
| 4        | `video`    | `video`    |
| 5        | `cover`    | `image`    |
| 6        | —          | `post`     |

Telegram cannot combine a cover with other media, so a lower-priority field present alongside a
higher-priority one comes back as a preview warning naming it.

## Body formatting

The body is sent **as written**. `bodyFormat` only picks the Bot API's `parse_mode`:

| `bodyFormat`                    | `parse_mode`             |
| ------------------------------- | ------------------------ |
| `text`                          | _(unset)_                |
| `html`                          | `HTML`                   |
| `md`                            | `Markdown`               |
| `MarkdownV2` or any other value | passed through unchanged |

```json
{ "body": "<b>Hello</b> <i>world</i>", "bodyFormat": "html" }
{ "body": "*Hello* _world_\\!", "bodyFormat": "MarkdownV2" }
```

`options.parse_mode` always wins over `bodyFormat`.

## Limits

|               |                 |
| ------------- | --------------- |
| Text message  | 4096 characters |
| Media caption | 1024 characters |
| Album items   | 1–10            |

Both limits are declared in the capability descriptor, so an over-long body is refused locally
rather than after a round trip. Read them at runtime with `client.getCapabilities('telegram')`.

## Media

`src` is either a public URL, which Telegram fetches itself, or a `file_id` for media Telegram
already stores. Nothing passes through your process either way — which is what makes a Workers
deployment viable here.

```json
{ "video": { "src": "BAACAgIAAxkBAAIC4mF9…" } }
{ "cover": { "src": "https://example.com/image.jpg", "hasSpoiler": true } }
```

In an album, an item given by `file_id` must also state its `type`: there is no URL extension left
to infer it from.

## Platform options

`options` accepts safe Bot API customizations using Telegram's own field names:

```json
{
  "options": {
    "reply_markup": {
      "inline_keyboard": [[{ "text": "Visit", "url": "https://example.com" }]]
    },
    "link_preview_options": { "is_disabled": true },
    "protect_content": true,
    "reply_parameters": { "message_id": 1234 }
  }
}
```

Destination and content fields (`chat_id`, `text`, `photo`, `video`, `audio`, `document`,
`caption`, and `disable_notification`) cannot be supplied through `options`. Use the corresponding
top-level request fields so validation, audit logs, and the actual Bot API call remain aligned.

## Fields Telegram ignores

`title`, `description`, `postLanguage`, `tags` are accepted and reported as ignored in a preview
warning.

`scheduledAt` and `mode: 'draft'` are **rejected**: Telegram schedules nothing and has no drafts,
and quietly dropping them would be worse than refusing them.

## Error mapping

| Bot API              | Code               | Retryable                           |
| -------------------- | ------------------ | ----------------------------------- |
| 429                  | `RATE_LIMIT_ERROR` | yes, after `parameters.retry_after` |
| 401, 403             | `AUTH_ERROR`       | no                                  |
| 400, content refused | `CONTENT_REJECTED` | no                                  |
| 400, other           | `VALIDATION_ERROR` | no                                  |
| 5xx                  | `PLATFORM_ERROR`   | yes                                 |
| no response          | `NETWORK_ERROR`    | yes                                 |

## License

MIT
