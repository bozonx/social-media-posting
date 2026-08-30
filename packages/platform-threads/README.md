# @bozonx/social-posting-threads

Threads support for [`@bozonx/social-posting`](https://github.com/bozonx/social-media-posting).

```ts
import { createPostingClient } from '@bozonx/social-posting';
import { threads } from '@bozonx/social-posting-threads';

const client = createPostingClient({
  accounts: {
    main: {
      platform: 'threads',
      target: { id: 'THREADS_USER_ID' },
      auth: { accessToken: '…' },
    },
  },
  platforms: [threads],
});
```

Threads publishes text, one image, one video, or a carousel through the container API. Media must
be a publicly fetchable URL and remain available while Meta processes the container. A successful
`post()` returns `processing`; persist its secret-free handle and call `checkStatus()` after the
reported delay. Do not repeat a final publish whose outcome is unknown.

Required permissions: `threads_basic` and `threads_content_publish`.
