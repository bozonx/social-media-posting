# @bozonx/social-posting-discord

Discord support for [`@bozonx/social-posting`](https://github.com/bozonx/social-media-posting).

```ts
import { createPostingClient } from '@bozonx/social-posting';
import { discord } from '@bozonx/social-posting-discord';

const client = createPostingClient({
  accounts: { main: { platform: 'discord', auth: { accessToken: '…' } } },
  platforms: [discord],
});
```

## Status

Scaffolded, not implemented. Before this ships:

- [ ] Fill `src/capabilities.ts` from the network's documentation.
- [ ] Implement `publish()` against the real API.
- [ ] Record real responses into `test/fixtures/`, failures included.
- [ ] Make the contract suite pass on Node and under `workerd`.
- [ ] Add a row to `docs/DELIVERY-SEMANTICS.md` for this network.
- [ ] Add a row to the support table in the root README.
