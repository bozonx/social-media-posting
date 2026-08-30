# @bozonx/social-posting-linkedin

LinkedIn Posts API support for `@bozonx/social-posting`.

The account target is the author URN (`urn:li:person:…` or `urn:li:organization:…`). Text posts
are sent directly. Image, video, and document posts accept previously uploaded LinkedIn asset URNs
as `platformRef` media sources. Upload registration belongs to the host until an upload can be
resumed without persisting LinkedIn's signed upload URL.

Required products/scopes depend on the author: `w_member_social` for members and
`w_organization_social` for organizations. LinkedIn product approval remains a live-smoke and
release prerequisite, not a code-generation prerequisite.

```ts
import { linkedin } from '@bozonx/social-posting-linkedin';
```
