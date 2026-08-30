# Delivery semantics

This library makes **at-most-one attempt per call** and stores **nothing**. Everything about
delivery guarantees follows from those two facts, so they are worth stating plainly before the
per-network detail.

## What the library does and does not do

| Concern                                                            | Owner                                       |
| ------------------------------------------------------------------ | ------------------------------------------- |
| Translating a request into platform API calls                      | this library                                |
| Choreographing a multi-step publication                            | this library                                |
| Classifying failures (`retryable`, `retryAfterMs`, `resumeHandle`) | this library                                |
| Resuming an interrupted multi-step publication                     | this library, from a handle the host stored |
| Deciding whether to retry, and waiting                             | the host                                    |
| Remembering that a post already went out                           | the host                                    |
| Rate limiting across processes                                     | the host                                    |

The library has no database, no cache and no cross-process coordination. An idempotency
mechanism built on any of those would have to be faked here, and a faked one is worse than none:
the previous version kept its records in one process's memory, which deduplicated nothing as soon
as a second replica existed, while looking like it did.

## The duplicate-risk window

A duplicate becomes possible exactly when the host cannot tell whether an attempt reached the
platform. The library narrows that window as far as a stateless component can:

- A failed **idempotent HTTP read** (`GET`, `HEAD`, `OPTIONS`, `PUT` or `DELETE`) with a replayable
  body is retried once inside `httpRequest()`. A bare `fetch` rejection cannot prove whether a
  mutating call reached the platform, so `POST` and `PATCH` are never repeated automatically.
- A **request that was sent and then failed** is never repeated automatically. The platform may
  have applied it. The error says `retryable` and, where the platform stated one, `retryAfterMs` —
  the host decides.
- A **multi-step publication that failed midway** carries a `resumeHandle`. Passing it to
  `post(request, { resume })` continues from the step that failed instead of re-running the
  earlier steps, which is what would otherwise create a second uploaded file or a second post.

- A **`create` whose outcome nobody confirmed** — a timeout, or a 5xx with no body — is never
  repeated. Repeating it is the single most common way a network ends up with two identical posts.
  What happens instead, in order:
  1. if the platform implements `reconcile()`, the library asks it whether the publication exists,
     and a `published` answer becomes an ordinary success result;
  2. if the network deduplicates on an idempotency key and the request carried one, the original
     retryable error is returned, because a repeat is safe;
  3. otherwise the host gets `UNKNOWN_OUTCOME` with `retryable: false`.

`UNKNOWN_OUTCOME` is not a failure and must not be shown as one. It means "the post may exist" —
the right response is to check the account, not to send again and not to mark the job failed.

The residual risk the host must handle: a response lost after the platform committed the post.
No stateless component can close that; only the host, which can record "attempt N was sent" before
sending, can.

## Resume handles carry no secrets

A handle is JSON the host stores in a job row, so it may not contain an access token, a signed
upload URL or an authorization header — those become secrets in the host's database, and they
expire long before the job might resume. Credentials are re-derived from the account when the
resume runs. The core scans every handle on its way out. `strictResumeHandles` is an explicit
host policy: enable it in development and tests to make a leak throw; disable it in production to
strip the offending field and log a warning. The library deliberately does not inspect `NODE_ENV`.
Newly produced handles carry `version: 1`; hosts must persist that field and adapters must reject
future versions they cannot interpret.

## Recommended host pattern

```ts
const result = await client.post(request, { resume: job.resumeHandle });

if (result.success) {
  if (result.data.status === 'processing') {
    // The platform accepted the content but has not materialized it yet.
    scheduleStatusCheck(job, result.data.handle, result.data.checkAfterMs ?? 60_000);
  } else {
    markPublished(job, result.data.postId);
  }
  return;
}

if (!result.error.retryable) {
  deadLetter(job, result.error);
  return;
}

// Store the handle so the next attempt resumes rather than restarts.
job.resumeHandle = result.error.resumeHandle;
scheduleRetry(job, result.error.retryAfterMs ?? backoff(job.attempts));
```

Two rules matter more than the rest:

1. **Persist `resumeHandle` before scheduling the retry.** It is plain JSON precisely so it can go
   into the job record. Dropping it turns a safe resume into a duplicate.
2. **Do not retry a non-retryable error.** `VALIDATION_ERROR`, `CONTENT_REJECTED` and
   `AUTH_ERROR` will fail identically forever. `AUTH_REFRESH_REQUIRED` means the channel needs
   re-authorization by a human — flag it, do not queue it.
3. **Handle `UNKNOWN_OUTCOME` separately from both.** It is neither success nor failure:

```ts
if (result.error.code === 'UNKNOWN_OUTCOME') {
  flagForHumanCheck(job, result.error); // the post may exist; never send again blindly
  return;
}
```

## Deferred publication

Some networks return a handle and materialize the post minutes later, after their own moderation.
For those, a successful `post()` can come back with `status: 'processing'` and no `postId`. The
host calls `client.checkStatus(request, handle)` on its own schedule; this library never polls,
because polling requires a scheduler and a scheduler requires durable state.

## Per-network notes

| Network  | Native idempotency | Duplicate window                                             | Reconciliation                                                                                                                                                                                                                                |
| -------- | ------------------ | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Telegram | none               | one Bot API call; a lost response after the message was sent | none from the API side — the Bot API cannot list a channel's recent messages, so a duplicate is only visible to a client that reads the channel                                                                                               |
| Discord  | none               | one REST call; a lost response after the message was created | none implemented — a bot token could list recent channel messages, but a webhook cannot read the channel at all, so the adapter declares neither `reconcile()` nor an idempotency key and an unconfirmed create surfaces as `UNKNOWN_OUTCOME` |

This table grows one row per network as networks land, and each row is filled in from that
network's documented behaviour rather than from assumption. A network is not "done" until its row
here says what happens when its response is lost.
