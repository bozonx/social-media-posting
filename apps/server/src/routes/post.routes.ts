import { Hono } from 'hono';
import { ValidationError } from '@bozonx/social-posting';
import {
  postRequestSchema,
  statusRequestSchema,
  deleteRequestSchema,
  streamPostRequestSchema,
  base64ToBytes,
  type mediaInputSchema,
} from '../config/schema.js';
import type { z } from 'zod';
import type {
  ResumeHandle,
  PostRequest,
  MediaInput,
  ThumbnailInput,
  PostRef,
} from '@bozonx/social-posting';
import type { PostService, PreviewService } from '@bozonx/social-posting/platform';

/** What the post routes need to do their job. */
export interface PostRouteDeps {
  postService: PostService;
  previewService: PreviewService;
  allowInlineAuth: boolean;
  includeRawResponses: boolean;
}

/** Media kinds that must not travel through the JSON endpoint. */
const INLINE_FORBIDDEN_KINDS = new Set(['video']);

function normalizeMediaInput(media: z.infer<typeof mediaInputSchema>): MediaInput {
  const { source, ...rest } = media;
  if (
    (source.kind === 'base64' || source.kind === 'bytes') &&
    media.type !== undefined &&
    INLINE_FORBIDDEN_KINDS.has(media.type)
  ) {
    // Base64 in JSON costs a third more bytes and has to be held whole in
    // memory twice over. Video goes through the streaming ingress or by URL.
    throw new ValidationError(
      'Video bytes are not accepted on the JSON endpoint. Publish it by URL, or stream it to POST /post/stream.',
    );
  }
  if (source.kind === 'base64') {
    return {
      ...rest,
      source: {
        kind: 'bytes',
        bytes: base64ToBytes(source.base64),
      },
    };
  }
  return media as MediaInput;
}

function normalizePostRequest(req: z.infer<typeof postRequestSchema>): PostRequest {
  const media = req.media?.map(normalizeMediaInput);
  const thumbnail = req.thumbnail
    ? (normalizeMediaInput(req.thumbnail) as ThumbnailInput)
    : undefined;
  return {
    ...req,
    media,
    thumbnail,
  } as PostRequest;
}

/**
 * `POST /post`, `POST /preview`, `POST /status`, and `POST /delete`.
 */
export function postRoutes(deps: PostRouteDeps): Hono {
  const routes = new Hono();

  routes.post('/post', async c => {
    const rawParsed = postRequestSchema.parse(await c.req.json());
    const { resume, ...rawRequest } = rawParsed;
    rejectInlineAuth(rawRequest.auth, deps.allowInlineAuth);

    const request = normalizePostRequest(rawRequest);

    const result = await deps.postService.publish(request, {
      signal: c.req.raw.signal,
      resume: resume as ResumeHandle | undefined,
      includeRaw: deps.includeRawResponses,
    });

    return c.json(result);
  });

  routes.post('/preview', async c => {
    const rawParsed = postRequestSchema.parse(await c.req.json());
    const { resume: _resume, ...rawRequest } = rawParsed;
    rejectInlineAuth(rawRequest.auth, deps.allowInlineAuth);

    const request = normalizePostRequest(rawRequest);
    return c.json(await deps.previewService.preview(request));
  });

  routes.post('/status', async c => {
    const { handle, ...request } = statusRequestSchema.parse(await c.req.json());
    rejectInlineAuth(request.auth, deps.allowInlineAuth);

    const status = await deps.postService.checkStatus(
      request,
      handle as ResumeHandle,
      c.req.raw.signal,
    );

    if (!deps.includeRawResponses) {
      if (status.success) {
        const { raw: _raw, reason, ...safeData } = status.data;
        return c.json({
          ...status,
          data: {
            ...safeData,
            reason: reason ? { ...reason, raw: undefined } : undefined,
          },
        });
      }
      return c.json({
        ...status,
        error: { ...status.error, raw: undefined },
      });
    }
    return c.json(status);
  });

  routes.post('/delete', async c => {
    const { ref, resume, platform, account, auth } = deleteRequestSchema.parse(await c.req.json());
    rejectInlineAuth(auth, deps.allowInlineAuth);

    const postRef: PostRef = typeof ref === 'object' ? (ref as PostRef) : { postId: String(ref) };

    const result = await deps.postService.delete(
      { platform: platform ?? '', account, auth },
      postRef,
      {
        signal: c.req.raw.signal,
        resume: resume as ResumeHandle | undefined,
        includeRaw: deps.includeRawResponses,
      },
    );

    return c.json(result);
  });

  return routes;
}

/**
 * `POST /post/stream`: one publication whose media is the request body.
 *
 * Mounted outside the JSON body limit on purpose. A 2 GB video cannot be a
 * JSON string, and materializing it to check its size would defeat the point:
 * the bytes are handed to the adapter as a `ReadableStream` and never held
 * whole. The post request itself travels in the `x-post-request` header as
 * base64 JSON, which keeps the body a pure byte stream.
 */
export function streamPostRoutes(deps: PostRouteDeps): Hono {
  const routes = new Hono();

  routes.post('/post/stream', async c => {
    const header = c.req.header('x-post-request');
    if (!header) {
      throw new ValidationError(
        'Header "x-post-request" is required: it carries the post request as base64-encoded JSON',
      );
    }

    let parsedHeader: unknown;
    try {
      parsedHeader = JSON.parse(new TextDecoder().decode(base64ToBytes(header))) as unknown;
    } catch {
      throw new ValidationError('Header "x-post-request" must be base64-encoded JSON');
    }

    const { resume, mediaMeta, ...rawRequest } = streamPostRequestSchema.parse(parsedHeader);
    rejectInlineAuth(rawRequest.auth, deps.allowInlineAuth);

    const body = c.req.raw.body;
    if (!body) {
      throw new ValidationError('POST /post/stream needs the media bytes as the request body');
    }

    let consumed = false;
    const media: MediaInput = {
      ...mediaMeta,
      source: {
        kind: 'stream',
        sizeBytes: mediaMeta?.sizeBytes,
        open: (openOptions?: { offsetBytes?: number }) => {
          // One pass over one request body: a resumed upload has to be a new
          // HTTP request, since there is nothing here to rewind.
          if (consumed || (openOptions?.offsetBytes ?? 0) > 0) {
            return Promise.reject(
              new ValidationError(
                'The streamed request body can be read once and cannot be rewound; resume by sending the request again',
              ),
            );
          }
          consumed = true;
          return Promise.resolve(body);
        },
      },
    };

    const request = normalizePostRequest(rawRequest);
    request.media = [media];

    const result = await deps.postService.publish(request, {
      signal: c.req.raw.signal,
      resume: resume as ResumeHandle | undefined,
      includeRaw: deps.includeRawResponses,
    });

    return c.json(result);
  });

  return routes;
}

function rejectInlineAuth(auth: Record<string, unknown> | undefined, allowed: boolean): void {
  if (auth && !allowed) {
    throw new ValidationError('Inline credentials are disabled; use a configured account');
  }
}
