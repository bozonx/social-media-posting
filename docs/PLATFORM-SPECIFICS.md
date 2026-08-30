# What every network makes you deal with

This document is for someone **using** this library. It is not a capability table — the machine
readable version of that is `platform.capabilities`, and it is the only thing you should branch on
in code. This page explains the parts that a capability descriptor cannot state: the assumptions a
network makes about _your_ application, your storage, your user, and your database.

Read it before you promise a network to your own users. Most integrations fail not on the HTTP
call but on one of the constraints below.

> Status: 2026-08-29. Only Telegram ships today. Every other section describes what the adapter
> will require of you, and is written from official documentation. Anything account-, tier-,
> region- or review-dependent is deliberately _not_ given as a number here, because it is not a
> number we are allowed to promise.

## The five questions to ask about any network

Every difference below reduces to one of these. When a new network is added, answer these five
before writing any code against it:

1. **Who authenticates, and does the token rotate?** A static API key you paste into a config is a
   different product from an OAuth2 grant that expires in an hour and must be re-authorized by the
   human every 60 days.
2. **Who moves the bytes?** Either you push media to the network (upload), or the network pulls it
   from a URL you host. Pull-based networks turn your object storage into a hard dependency and
   expose your media URLs to a third party.
3. **Is publishing one call or several?** Multi-step publication means partial failure is a real
   state your database has to represent.
4. **Is the post live when the call returns?** Several networks return "accepted", not
   "published", and the difference can be minutes.
5. **What does the network call the thing you are posting?** "A short vertical video" is a Reel, a
   Short, a TikTok video and a plain video post, and the four are not interchangeable.

## Cross-cutting rules

### Post type is your decision, not ours

The library detects `post` / `image` / `album` / `video` from the media you attach. It does
**not** guess `shortVideo` versus `video`, or `story` versus anything else. Orientation and
duration are not evidence: a vertical 30-second clip is a legitimate Reel, Story or ordinary
video, and picking wrong publishes to the wrong surface with no way to move it.

So: **if you mean a Short/Reel or a Story, set `type` explicitly.** If you do not, you get a
normal post or video. Unsupported combinations are rejected locally, before any HTTP call — the
library never silently downgrades one format into another.

### `article` is a native format, not a long post

`type: 'article'` is only accepted by networks with a real article API. It carries a structured
document (title plus ordered blocks, with images positioned _inside_ the text), not a `body`
string with attachments beside it. If a network has no article API, the request is rejected as
unsupported and you must choose `post` — the library will not flatten an article for you, because
flattening loses the image positions and the result is not the document you wrote.

### Pull-based networks need public URLs, and that is your problem

Meta (Facebook, Instagram, Threads) and TikTok's photo flow do not accept your bytes. You give
them a URL and their servers fetch it. That means:

- The URL must be reachable from the public internet with **no interactive authorization**. A
  signed, unguessable URL is fine; a login page is not.
- It must stay valid for the **whole** processing window, not just the moment of the call —
  including across your own retries and resumes. A five-minute signed URL will bite you.
- A third party now holds that URL. Treat it as disclosed: scope the token to one media object,
  make it read-only, and expire it after publication rather than never.
- This library does **not** provide that storage. It is stateless by design. Hosting temporary
  public media is the host application's job.

If you only have bytes, you must upload them somewhere public first. There is no way around this
for Meta.

### Nothing here polls, and nothing here remembers

`post()` makes at most one attempt and stores nothing. Two consequences you must design for:

- When a result comes back `status: 'processing'`, **you** own the polling loop and the schedule
  — call `checkStatus()` on the returned handle. See `DELIVERY-SEMANTICS.md`.
- When a multi-step publication fails midway, the error carries a `resumeHandle`. Persist it and
  pass it to the next attempt. Retrying the whole request instead will upload the file a second
  time and can create a second post.

The handle is deliberately plain JSON so you can put it in a database column. For the same reason
it never contains an access token or a signed upload URL — do not expect one to be there, and do
not add one if you write an adapter.

### Retrying a publish is not automatically safe

Failed idempotent HTTP calls are retried once inside the library. A `POST` that was sent and then
failed is **never** repeated automatically, because the network may already have applied it. If
you retry a create call yourself after an ambiguous failure, you can create a duplicate. Only
Mastodon offers a real idempotency key; for everything else, record "attempt sent" in your own
storage before sending.

### Rate limits and quotas are not constants

Static numbers in a capability descriptor are documentation, not permission. Instagram's publish
quota is a rolling window you must query. TikTok's caps and the creator's allowed privacy options
must be fetched _before every post_. X's limits follow a paid product tier. YouTube spends a large
share of a daily quota on a single upload. Budget for `QUOTA_EXCEEDED` as a normal outcome and
surface it to the user as "try tomorrow", not as a bug.

## Per-network notes

### Telegram — _shipping_

The easy one, and the reason it is a bad mental model for the rest.

- Auth is a static bot token. Nothing expires, nothing rotates, no review board.
- One call publishes. No processing state, no resume handle in the normal path.
- The bot must be an administrator of the target channel; that is the only "eligibility" check.
- Media groups take up to 10 items and cannot mix audio with photos/videos.
- Captions are far shorter than a text-only message. Attaching a picture to a long post is a
  destructive change to the text length budget, not a decoration.
- Uploading by URL has much tighter size limits than uploading bytes.
- A `platformRef` source is a Telegram `file_id`: reusing one is free and instant, and this is the
  cheapest way to repost the same media.

Do not generalize any of this. Telegram is the exception on nearly every axis.

### Facebook Pages

- **Pages only.** Not personal profiles, not Groups.
- You need a Page access token, which is not a user access token — obtaining one is an extra
  exchange step your OAuth code must perform. Page and Instagram use different identifiers and
  different permissions even when they are the same "account" to the human.
- Galleries are built by creating each photo _unpublished_ and then referencing them from one feed
  post. If the last step fails you are left with orphaned unpublished photos in the Page's
  library. This is why gallery publication reports `parts` and produces a resume handle.
- Reels and ordinary videos are different flows, both resumable, both asynchronous.
- Stories are not supported until we have confirmed the current Page Stories create endpoint; the
  library will reject `type: 'story'` rather than guess.
- The Graph API version is pinned to one constant. Upgrading it is a deliberate, reviewed change,
  not something that drifts.

### Threads

- Two-step: create a container, then publish it. **A container ID is not a post.** If you store
  the container ID as your published post reference, you have stored nothing useful.
- Containers expire. If your queue stalls between the two steps, the publication is lost and must
  be restarted from the beginning.
- Media is pull-based. See the public-URL rules above.
- There is no separate "short video" format — a vertical video is simply a video post. There are
  no Stories.

### Instagram

- **Professional accounts only** (Business/Creator). A personal account cannot publish through the
  API, and there is nothing the library can do about it. Validate account eligibility during
  onboarding, not at publish time.
- **There is no text-only post.** Media is mandatory. A publication that is a paragraph of text
  has no Instagram representation.
- Same container-then-publish model as Threads, with the same expiry trap, plus an explicit
  processing wait: the container must reach `FINISHED` before you may publish it.
- Publishing quota is a rolling limit that must be read from the official quota endpoint. Do not
  cache it as a constant.
- Reels, carousels and Stories have genuinely different media rules (aspect ratio, duration,
  codecs). They are separate declared types with separate validation; a carousel is not a Story
  with more pictures.

### YouTube

- Video only. There is no text post, no image post, no gallery.
- Upload is a resumable `PUT` protocol: initiate, keep the returned session URI, send chunks that
  are multiples of 256 KiB. After an ambiguous failure, ask the server for the current offset
  rather than restarting.
- The session URI is a credential. It never appears in logs or in the raw response we hand back.
- `title`, `privacyStatus` and `categoryId` are mandatory. A category default belongs in your
  account configuration.
- **Shorts are not an endpoint.** A Short is an ordinary upload that YouTube classifies as a Short
  by its own current product rules. We validate the documented duration and aspect constraints;
  we cannot promise the classification.
- Success means "the video exists", not "the video is watchable". Processing continues after the
  call returns, and `checkStatus()` reports it.
- **If your OAuth consent screen is unverified, every upload is forced private** regardless of what
  you asked for. This surprises people in production, not in testing.
- Uploads are expensive in daily quota units. A handful of videos can exhaust a default project.
- Maximum file size and duration also depend on whether the _channel_ is verified.

### TikTok

The most constrained integration in this list, and the one most likely to be refused at review.

- **Creator Info must be fetched before every post**, and its answer used: allowed privacy levels,
  disabled interaction settings, and the maximum video duration for this creator. These are not
  static capabilities and must never be cached as such.
- Access is gated on app review/audit. Until your client is audited, posts are forced private.
- The API assumes a real end-user experience: the creator must see and confirm the settings
  screen. A fully headless auto-poster does not satisfy the content sharing guidelines. If you are
  building an internal tool for your own team's account, read those guidelines before you build.
- Direct posting and draft upload are different scopes (`video.publish` vs `video.upload`). Draft
  mode is an explicit choice, not a fallback.
- Photo posts are images only, pull-based, and the source domain must be verified with TikTok in
  advance.
- Daily posting caps are dynamic. Watermarks from other platforms are prohibited content.
- No Stories. No text-only posts.

### X

- Publishing requires a **user-context** token. An app-only bearer token cannot create a post, no
  matter what scopes it has.
- The API is paid, and limits follow the product tier. Anything tier-dependent is left out of the
  static descriptor on purpose.
- Media goes through a separate upload service first; you then attach `media_ids`. Large files and
  video use a chunked INIT/APPEND/FINALIZE sequence, after which processing is asynchronous.
- Either up to four images **or** one video/GIF. Not both, and not a mixed gallery. A poll cannot
  coexist with media.
- **Character counting is not `string.length`.** URLs count as a fixed weight regardless of their
  real length, and some ranges count double. The library validates with X's rule; do not
  pre-truncate with your own counter and expect the numbers to agree.
- Video duration and size limits depend on account access level.
- Short and long video are the same thing here — one video post. No Stories.

### Pinterest

- **A board is mandatory.** There is no such thing as posting to Pinterest generally; a Pin
  without a board target is not a valid request.
- No text-only Pins, no Stories, no organic carousel. Several images means several independent
  Pins, which is several publications — the library will not pretend that is one album, because
  deleting or editing "it" later would be ambiguous.
- Video Pins are a three-step flow: register the upload, push the file to the storage endpoint
  Pinterest hands you with the exact form fields it specifies, poll media status until it
  succeeds, and only then create the Pin.
- A video Pin requires a publicly reachable **cover image URL**. It is not optional and it is not
  generated for you.

## Networks on the roadmap, and what will change for you

These are not implemented. They are listed because they each break an assumption that the seven
above let you keep, and it is cheaper to know now.

| Network                | The assumption it breaks                                                                                                                                                                                                                                                      |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Mastodon**           | There is no single API host. Every instance is a separate server with its own limits, its own character count, its own media rules and its own custom emoji. Capabilities must be discovered per account, at runtime. It also has the only real idempotency key in this list. |
| **Bluesky**            | Same multi-host problem (the account's PDS). Content is a typed record with byte-offset facets for links and mentions, so the text and its markup are validated together, and images are blobs uploaded separately.                                                           |
| **Vimeo**              | Video-only like YouTube, but the constraint is a per-account **storage quota**, not a daily operation quota — a different failure mode with a different message to your user.                                                                                                 |
| **WhatsApp Channels**  | No documented public API for posting Channel updates today. It is in the catalog as _unavailable_, and a catalog entry is not an adapter.                                                                                                                                     |
| **VK / OK / regional** | Non-OAuth2 or dialect-OAuth2 auth, region-specific API hosts, and error messages that are not in English. Error _codes_ stay stable; error _messages_ should never be shown to your users untranslated.                                                                       |

The consequence for the core, and therefore for you: an account's configuration is not just a
token. It can carry an instance/API host, and its capabilities may have to be resolved per account
rather than read from a constant. Write your integration so that it asks the client for
capabilities for _an account_, not for _a platform name_.

## A checklist before you enable a network in production

- [ ] You know whether the token rotates, and if it does, you persist refreshed credentials via
      `CredentialProvider.onCredentialsRefreshed`. A rotating refresh token you fail to store
      locks the account out permanently.
- [ ] You handle `AUTH_REFRESH_REQUIRED` by flagging the channel for re-authorization, not by
      retrying.
- [ ] For pull-based networks, you host public media URLs that outlive the processing window.
- [ ] You persist `resumeHandle` and pass it back on the next attempt.
- [ ] You persist the `processing` handle and have a scheduler that calls `checkStatus()`.
- [ ] You store the full `ref`, including `parts`, and not just a post ID — multi-object
      publications cannot be cleaned up from an ID alone.
- [ ] You record "attempt sent" before calling `post()`, so an ambiguous failure does not become a
      duplicate.
- [ ] You set `type` explicitly for Shorts/Reels and Stories.
- [ ] You surface `QUOTA_EXCEEDED` and `CONTENT_REJECTED` to the user as distinct, non-retryable
      outcomes.
- [ ] You have completed whatever review the network requires, and you have tested with an account
      of the right kind (Page, professional, verified channel, audited app).
