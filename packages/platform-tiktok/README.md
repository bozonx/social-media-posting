# @bozonx/social-posting-tiktok

TikTok Content Posting API support for `@bozonx/social-posting`.

The adapter queries Creator Info before every publication (`cacheableForSecs: 0`), submits public
media URLs through Direct Post, and returns a secret-free handle while TikTok processes the post.
Call `checkStatus()` with that handle until the result is published or failed. Video, short video,
single-photo and photo carousel requests are supported.

The OAuth grant needs `video.publish`; an audited TikTok app is still required for live use.

```ts
import { tiktok } from '@bozonx/social-posting-tiktok';
```
