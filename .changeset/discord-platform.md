---
'@bozonx/social-posting-discord': minor
---

Add the Discord platform package.

Publishes text, single attachments, albums of up to ten files and native polls, over both of
Discord's access models: a webhook URL (which is credential and destination in one secret) and a
bot token (which addresses a channel and can reply and delete). The attachment ceiling is read per
account through `resolveCapabilities()`, because it is a property of the server's boost tier
rather than of the network.
