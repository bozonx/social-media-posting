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
      target: '@my_channel',
    },
  },
  platforms: [telegram],
});
```

## Account configuration

| Field               | Type             | Meaning                                            |
| ------------------- | ---------------- | -------------------------------------------------- |
| `auth.apiKey`       | string           | Bot token, `123456789:ABC-DEF…`                    |
| `target`            | string \| number | `@channel`, `-1001234567890`, or a numeric chat id |
| `silent`            | boolean          | Send silently by default                           |
| `apiTimeoutSeconds` | number           | Per-call Bot API timeout                           |
| `maxBodyLength`     | number           | A stricter body limit than Telegram's own          |

The target chat is resolved from `request.target`, then the account's `target`.

## Post types

| Type       | Bot API method   |
| ---------- | ---------------- |
| `post`     | `sendMessage`    |
| `image`    | `sendPhoto`      |
| `video`    | `sendVideo`      |
| `audio`    | `sendAudio`      |
| `document` | `sendDocument`   |
| `album`    | `sendMediaGroup` |
| `poll`     | `sendPoll`       |

### Automatic detection

With `type` omitted or `auto`, the first matching shape decides:

- `poll` present → `poll`
- `media[]` with multiple items → `album`
- `media[]` with 1 item → matching kind (`image`, `video`, `audio`, `document`)
- `body` only → `post`

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

`extra.parse_mode` always wins over `bodyFormat`.

## Limits

|               |                 |
| ------------- | --------------- |
| Text message  | 4096 characters |
| Media caption | 1024 characters |
| Album items   | 1–10            |
| Poll options  | 2–10            |

Limits are declared in the capability descriptor, so an over-long body or excess media is refused locally
rather than after a round trip. Read them at runtime with `client.getCapabilities('telegram')`.

## Media

Telegram accepts a public URL or a `platformRef` containing a `file_id` it already stores. This
adapter deliberately does not upload byte, Blob, or stream sources; inspect
`capabilities.media[type].acceptedSources` when selecting transport.

```json
{
  "media": [
    {
      "type": "image",
      "source": { "kind": "url", "url": "https://example.com/image.jpg" },
      "sensitive": true
    }
  ]
}
```

## Extra fields

`extra` accepts safe Bot API customizations using Telegram's own field names:

```json
{
  "extra": {
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
`caption`, and `disable_notification`) cannot be supplied through `extra`. Use the corresponding
top-level request fields so validation, audit logs, and the actual Bot API call remain aligned.

## Deletion

Telegram supports message deletion via `client.delete(request, ref)`. Telegram messages can be deleted
up to 48 hours after posting.

## Fields Telegram ignores

`title`, `description`, `language`, `tags` are accepted and reported as ignored in a preview
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
