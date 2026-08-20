import { Hono } from 'hono';
import { ValidationError } from '@bozonx/social-posting';
import {
  postRequestSchema,
  statusRequestSchema,
  deleteRequestSchema,
  base64ToBytes,
  type mediaInputSchema,
} from '../config/schema.js';
import type { z } from 'zod';
import type {
  PostService,
  PreviewService,
  ResumeHandle,
  PostRequest,
  MediaInput,
  ThumbnailInput,
  PostRef,
} from '@bozonx/social-posting';

/** What the post routes need to do their job. */
export interface PostRouteDeps {
  postService: PostService;
  previewService: PreviewService;
  allowInlineAuth: boolean;
  includeRawResponses: boolean;
}

function normalizeMediaInput(media: z.infer<typeof mediaInputSchema>): MediaInput {
  const { source, ...rest } = media;
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

    const result = await deps.postService.delete(ref as PostRef | string | number, {
      platform,
      account,
      auth,
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
