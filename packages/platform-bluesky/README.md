# @bozonx/social-posting-bluesky

Bluesky/AT Protocol publishing for `@bozonx/social-posting`, using Web APIs and direct XRPC calls.

Set the account PDS as `apiBaseUrl`. Credentials contain `accessToken`, `refreshToken`, and `did`. The host must implement `CredentialProvider.onCredentialsRefreshed` because `refreshSession` rotates both JWTs.

Text is limited in grapheme clusters; facets use UTF-8 byte offsets. Links, hashtags, and resolvable mentions become facets. Images upload to the PDS. Video returns a secret-free processing handle until transcoding supplies a blob.

Replies use the AT URI in `inReplyTo.id` and the CID in `inReplyTo.extra.cid`; add `rootUri` and `rootCid` below the root. Explicit `thread` segments form a reply chain.
