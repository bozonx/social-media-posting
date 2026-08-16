import { Hono } from 'hono';
import { postRequestSchema, statusRequestSchema } from '../config/schema.js';
import type {
  PostRequest,
  PostService,
  PreviewService,
  ResumeHandle,
} from '@bozonx/social-posting';

/** What the post routes need to do their job. */
export interface PostRouteDeps {
  postService: PostService;
  previewService: PreviewService;
}

/**
 * `POST /post`, `POST /preview` and `POST /status`.
 *
 * The shell is strictly stateless: it parses JSON, calls the library, and
 * returns the result. It stores nothing, retries nothing and deduplicates
 * nothing, so a non-Node caller has exactly the same capabilities — and exactly
 * the same responsibilities — as an in-process one.
 */
export function postRoutes(deps: PostRouteDeps): Hono {
  const routes = new Hono();

  routes.post('/post', async c => {
    const { resume, ...request } = postRequestSchema.parse(await c.req.json());

    // The client hung up: stop the platform call rather than finishing a
    // publish nobody will hear the result of.
    const result = await deps.postService.publish(request as PostRequest, {
      signal: c.req.raw.signal,
      resume: resume as ResumeHandle | undefined,
    });

    return c.json(result);
  });

  routes.post('/preview', async c => {
    const { resume: _resume, ...request } = postRequestSchema.parse(await c.req.json());
    return c.json(await deps.previewService.preview(request as PostRequest));
  });

  routes.post('/status', async c => {
    const { handle, ...request } = statusRequestSchema.parse(await c.req.json());

    const status = await deps.postService.checkStatus(
      request,
      handle as ResumeHandle,
      c.req.raw.signal,
    );

    return c.json(status);
  });

  return routes;
}
