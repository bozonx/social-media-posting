# @bozonx/social-posting-instagram

Instagram support for [`@bozonx/social-posting`](https://github.com/bozonx/social-media-posting).

```ts
import { createPostingClient } from '@bozonx/social-posting';
import { instagram } from '@bozonx/social-posting-instagram';

const client = createPostingClient({
  accounts: {
    main: { platform: 'instagram', target: { id: 'IG_USER_ID' }, auth: { accessToken: '…' } },
  },
  platforms: [instagram],
});
```

Instagram supports image posts, video/Reels, Stories, and carousels for professional accounts.
Every media item must be a publicly fetchable URL. Publishing is asynchronous: persist the
container handle returned by `post()` and pass it to `checkStatus()`. The descriptor exposes the
rolling 100-publication limit; hosts should treat it as a quota, not a retry loop.

Required permissions: `instagram_basic` and `instagram_content_publish`.
