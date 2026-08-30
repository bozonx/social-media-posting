# Changelog

## Unreleased

- Added source-backed, versioned capability profiles for Facebook, Threads, Instagram,
  WhatsApp Channels, YouTube, Vimeo, TikTok, Mastodon, X, Bluesky, Snapchat,
  Discord, Pinterest, LinkedIn, Reddit, Twitch, Kwai, and Dailymotion.
- Added type-specific body/title/description/tag limits and source-specific media byte limits.
- Telegram capabilities now own caption and URL-upload size limits, and expose reusable local
  credential validation.
- Corrected Telegram media capabilities to match the implemented URL/file-id transport, enforced
  the Bot API's 2–10 item album size, and preserved audio/document album media types.
- Telegram albums now reject ambiguous media URLs and invalid mixed media before publishing, and
  only send spoiler fields for photo/video items.
