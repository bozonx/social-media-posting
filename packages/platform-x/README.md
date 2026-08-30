# @bozonx/social-posting-x

X API v2 post creation for `@bozonx/social-posting`.

Text, image/video media references, polls, replies and quote posts are supported. URLs count with
X's fixed weight of 23 characters. Media must already be uploaded and is passed as a
`platformRef`; this keeps upload-session secrets out of stateless resume handles.

The OAuth 2 grant needs `tweet.read tweet.write users.read offline.access`, and the application
must have an X API tier that permits post creation.

```ts
import { x } from '@bozonx/social-posting-x';
```
