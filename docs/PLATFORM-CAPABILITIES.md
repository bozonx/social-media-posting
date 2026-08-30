# Platform capability sources

Runtime capability descriptors live with platform adapters. Future and restricted integrations
are tracked by `@bozonx/social-posting-platform-catalog`. A catalog profile is validation data,
not proof that a publishing adapter is installed.

Each blocking value must cite official documentation through `capabilities.sources`. Values that
are account-, instance-, subreddit-, or partner-specific stay out of static limits and must be
discovered at runtime.

| Profile           | Public publishing API | Important qualification                                              |
| ----------------- | --------------------- | -------------------------------------------------------------------- |
| Facebook          | Available             | Page publishing requires Page access and permissions.                |
| Threads           | Available             | Container-based publishing and app permissions apply.                |
| Instagram         | Available             | Professional accounts, public media URLs, and rolling publish quota. |
| WhatsApp Channels | Unavailable           | No documented public Cloud API for Channel updates.                  |
| YouTube           | Available             | Upload quota and audit restrictions apply.                           |
| Vimeo             | Available             | Upload access and account storage quota apply.                       |
| TikTok            | Restricted            | Direct posting requires review and creator controls.                 |
| Mastodon          | Available             | Limits are instance configuration and require discovery.             |
| X                 | Available             | Product tier and weighted character counting apply.                  |
| Bluesky           | Available             | AT Protocol record and blob constraints apply.                       |
| Snapchat          | Restricted            | Public Profile API access is approval-based.                         |
| Discord           | Available             | Bot/webhook permissions and guild upload tier apply.                 |
| Pinterest         | Available             | Pins require a board and media-specific flows.                       |
| LinkedIn          | Restricted            | Publishing products and scopes require approval.                     |
| Reddit            | Available             | Subreddit requirements must be fetched before submit.                |
| Twitch            | Restricted            | No general-purpose social post upload endpoint.                      |
| Kwai              | Restricted            | Access and documentation vary by partner program and region.         |
| Dailymotion       | Available             | Video upload and account quota apply.                                |

## Monitoring contract

An automated monitor may propose changes, but it must not mutate runtime limits directly. It
should compare official sources with the descriptor, update `verifiedAt`, attach evidence, and
open a reviewed change with validation fixtures. Removed or inaccessible documentation is a
warning, not permission to replace a value with an unofficial blog claim.
