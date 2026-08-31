# @bozonx/social-posting-x

X API v2 post creation for `@bozonx/social-posting`.

Text, images, video, polls, replies and quote posts are supported. URLs count with X's fixed
weight of 23 characters. Media can be supplied as URL, bytes, Blob, reopenable stream, or an
already uploaded `platformRef`. The adapter uploads non-reference media with X's chunked upload
flow; video can return `processing`, and upload progress is kept in a secret-free resume handle.

The OAuth 2 grant needs `tweet.read tweet.write users.read offline.access`, and the application
must have an X API tier that permits post creation.

```ts
import { x } from '@bozonx/social-posting-x';
```
