# Delivery semantics

This library makes **at-most-one attempt per call** and stores **nothing**. Everything about
delivery guarantees follows from those two facts, so they are worth stating plainly before the
per-network detail.

## What the library does and does not do

| Concern | Owner |
| --- | --- |
| Translating a request into platform API calls | this library |
| Choreographing a multi-step publication | this library |
| Classifying failures (`retryable`, `retryAfterMs`, `resumeHandle`) | this library |
| Resuming an interrupted multi-step publication | this library, from a handle the host stored |
| Deciding whether to retry, and waiting | the host |
| Remembering that a post already went out | the host |
| Rate limiting across processes | the host |

The library has no database, no cache and no cross-process coordination. An idempotency
mechanism built on any of those would have to be faked here, and a faked one is worse than none:
the previous version kept its records in one process's memory, which deduplicated nothing as soon
as a second replica existed, while looking like it did.

## The duplicate-risk window

A duplicate becomes possible exactly when the host cannot tell whether an attempt reached the
platform. The library narrows that window as far as a stateless component can:

- A **connection failure before the request completed** is retried once inside `httpRequest()`.
  Nothing was acted on, so the repeat is free of risk. This is the only automatic retry anywhere
  in the library.
- A **request that was sent and then failed** is never repeated automatically. The platform may
  have applied it. The error says `retryable` and, where the platform stated one, `retryAfterMs` —
  the host decides.
- A **multi-step publication that failed midway** carries a `resumeHandle`. Passing it to
  `post(request, { resume })` continues from the step that failed instead of re-running the
  earlier steps, which is what would otherwise create a second uploaded file or a second post.

The residual risk the host must handle: a response lost after the platform committed the post.
No stateless component can close that; only the host, which can record "attempt N was sent" before
sending, can.

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

## Deferred publication

Some networks return a handle and materialize the post minutes later, after their own moderation.
For those, a successful `post()` can come back with `status: 'processing'` and no `postId`. The
host calls `client.checkStatus(request, handle)` on its own schedule; this library never polls,
because polling requires a scheduler and a scheduler requires durable state.

## Per-network notes

| Network | Native idempotency | Duplicate window | Reconciliation |
| --- | --- | --- | --- |
| Telegram | none | one Bot API call; a lost response after the message was sent | none from the API side — the Bot API cannot list a channel's recent messages, so a duplicate is only visible to a client that reads the channel |

This table grows one row per network as networks land, and each row is filled in from that
network's documented behaviour rather than from assumption. A network is not "done" until its row
here says what happens when its response is lost.
