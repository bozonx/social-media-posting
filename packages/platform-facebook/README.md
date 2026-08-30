# @bozonx/social-posting-facebook

Facebook support for [`@bozonx/social-posting`](https://github.com/bozonx/social-media-posting).

```ts
import { createPostingClient } from '@bozonx/social-posting';
import { facebook } from '@bozonx/social-posting-facebook';

const client = createPostingClient({
  accounts: {
    main: { platform: 'facebook', target: { id: 'PAGE_ID' }, auth: { accessToken: '…' } },
  },
  platforms: [facebook],
});
```

Facebook publishes to Pages, not personal profiles. Text, a single photo, a video, multi-photo
posts, and Reels use separate Graph API flows. Media must be a publicly fetchable URL. A failed
gallery upload carries the IDs of already-created unpublished photos in its resume handle, so a
retry continues instead of creating duplicate artifacts. Reels finish through `checkStatus()`.

Required permissions: `pages_manage_posts` and `pages_read_engagement`.
