# OAuth and credentials

Most networks worth adding — X, LinkedIn, TikTok, YouTube, Meta, Threads, Pinterest, Reddit — sit
behind OAuth2 with expiring tokens. This document draws the line between what this library does
with those tokens and what the host application must do, and it is drawn deliberately before the
first OAuth network lands rather than after.

## The line

| Step                                                                     | Owner    |
| ------------------------------------------------------------------------ | -------- |
| Registering an app with the network and holding the client ID and secret | host     |
| Redirecting a user to the network's consent screen                       | **host** |
| Receiving the `?code=` callback and exchanging it for the first tokens   | **host** |
| Storing tokens, encrypted, against a user or channel                     | **host** |
| Deciding when a channel needs re-authorization and telling the user      | **host** |
| Knowing that an access token has expired                                 | library  |
| Performing the `refresh_token` grant                                     | library  |
| Handing rotated tokens back for storage                                  | library  |
| Reporting that only re-authorization can help                            | library  |

The authorization-code redirect is not implemented here and will not be. It needs a browser, a
public callback URL, session state and a CSRF-protected `state` parameter — all of which belong to
a web application. A library that tried to own it would force every consumer into its idea of what
a web application looks like.

## What the host implements

```ts
import type { CredentialProvider, ResolvedCredentials } from '@bozonx/social-posting';

class VaultCredentials implements CredentialProvider {
  async getCredentials(accountRef: string): Promise<ResolvedCredentials> {
    const row = await db.channels.findByRef(accountRef);
    return {
      accessToken: decrypt(row.accessToken),
      refreshToken: decrypt(row.refreshToken),
      expiresAt: row.expiresAt, // ISO 8601 or epoch milliseconds
    };
  }

  async onCredentialsRefreshed(accountRef: string, next: ResolvedCredentials): Promise<void> {
    await db.channels.update(accountRef, {
      accessToken: encrypt(next.accessToken),
      refreshToken: encrypt(next.refreshToken),
      expiresAt: next.expiresAt,
    });
  }
}

const client = createPostingClient({
  accounts,
  platforms: [linkedin],
  credentialProvider: new VaultCredentials(),
});
```

`onCredentialsRefreshed` is optional in the type only because static-token networks never call it.
**Any host serving an OAuth2 network must implement it.** Most providers rotate the refresh token
on every use: a refreshed token that is not persisted means the next refresh presents a spent one,
and the account locks itself out — the failure looks like "it worked for an hour, then stopped".

## What the library does

`OAuth2TokenRefresher` performs the standard `refresh_token` grant, and handles the two things that
are easy to get subtly wrong in each network separately:

- **Clock skew.** A token that expires "now" has usually expired already. The refresher treats a
  token as expired one minute early by default. A wasted refresh costs one request; a token
  believed valid one second too long costs a failed publish.
- **Single flight.** Two posts to the same account starting at the same moment must not trigger two
  refreshes. With rotating refresh tokens the second request presents a token the first one already
  invalidated. Concurrent refreshes for one account collapse into a single request; different
  accounts refresh independently.

Only `fetch`, `URLSearchParams` and Web Crypto are used, so the same code runs on Node, Workers,
Deno and Bun.

## Per-instance client credentials

On Mastodon and Pixelfed the client id and secret are issued **by each instance**, so they are not
package constants — they are account state. `OAuth2TokenRefresher` therefore takes either a config
object or a function of the account:

```ts
new OAuth2TokenRefresher(
  account => ({
    tokenEndpoint: `${account.apiBaseUrl}/oauth/token`,
    clientId: account.auth.clientId as string,
    clientSecret: account.auth.clientSecret as string,
  }),
  credentialProvider,
);
```

The `CredentialProvider` stores `clientId` and `clientSecret` next to the tokens, and the host must
persist them: an instance's app registration cannot be recovered from anywhere else.

Registering the application is one request, and the library builds it:

```ts
const { url, init } = buildAppRegistrationRequest({
  apiBaseUrl: 'https://mastodon.social',
  clientName: 'Your App',
  redirectUris: ['https://yourapp.example/oauth/callback'],
  scopes: ['write:statuses', 'write:media'],
});
```

Performing it, and the redirect flow that follows, stays with the host — only the host has storage
and an HTTP endpoint to be redirected to.

## OAuth2 is not the only path

`IPlatform` does not require it. ATProto authenticates with an app password and refreshes its own
session; a network with an API key never refreshes at all. Nothing in the core assumes a token
endpoint exists, and a platform is free to keep its own refresh mechanism.

## Telling the host to re-authorize

When only a human can fix the situation, the failure comes back as `AUTH_REFRESH_REQUIRED`:

```ts
if (!result.success && result.error.code === 'AUTH_REFRESH_REQUIRED') {
  await db.channels.markNeedsReauthorization(accountRef);
  await notifyOwner(accountRef);
  return; // never retry
}
```

The distinction matters operationally. `AUTH_ERROR` can mean a transient problem at the provider.
`AUTH_REFRESH_REQUIRED` means the grant is gone: the refresh token was revoked, expired or already
spent. Retrying it forever is how a queue fills with jobs that can never drain.

A platform's `IAuthValidator` can return the same code from `validate()`, so a channel known to be
unusable is rejected before a single API call is made.
