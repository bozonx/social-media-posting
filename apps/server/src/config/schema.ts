import { z } from 'zod';
import {
  MAX_BODY_LIMIT,
  MAX_DESCRIPTION_LENGTH,
  MAX_MEDIA_SRC_LENGTH,
  MAX_TAG_LENGTH,
  MAX_TAGS,
  MAX_TITLE_LENGTH,
} from '@bozonx/social-posting';

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64.replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** A destination: a scalar shorthand, or a composite address with an `id`. */
export const targetSchema = z.union([
  z.string().min(1),
  z.number(),
  z.looseObject({ id: z.string().min(1) }),
]);

/** One configured account: a platform, its credentials, and its defaults. */
export const accountSchema = z
  .object({
    platform: z.string().min(1),
    auth: z.record(z.string(), z.unknown()).default({}),
    target: targetSchema.optional(),
    apiBaseUrl: z.url().startsWith('https://').optional(),
    maxBodyLength: z.number().int().min(1).max(MAX_BODY_LIMIT).optional(),
    silent: z.boolean().optional(),
  })
  .loose();

/**
 * The shell's configuration file.
 */
export const serverConfigSchema = z.object({
  requestTimeoutSecs: z.number().int().min(1).max(600).default(60),
  /** Fail loudly when an adapter puts a secret in a resume handle. On in dev. */
  strictResumeHandles: z.boolean().default(false),
  accounts: z.record(z.string(), accountSchema).default({}),
});

export type ServerConfig = z.infer<typeof serverConfigSchema>;

export const mediaSourceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('url'),
    url: z.string().min(1).max(MAX_MEDIA_SRC_LENGTH),
  }),
  z.object({
    kind: z.literal('platformRef'),
    ref: z.string().min(1).max(MAX_MEDIA_SRC_LENGTH),
  }),
  z.object({
    kind: z.literal('base64'),
    base64: z.string().min(1),
  }),
  z.object({
    kind: z.literal('bytes'),
    bytes: z.custom<Uint8Array>(
      val =>
        val instanceof Uint8Array ||
        (typeof val === 'object' && val !== null && 'byteLength' in val),
    ),
  }),
]);

/** Media accepted on a request: a source plus per-item options. */
export const mediaInputSchema = z
  .object({
    source: mediaSourceSchema,
    type: z.enum(['image', 'video', 'audio', 'document']).optional(),
    mimeType: z.string().optional(),
    fileName: z.string().optional(),
    altText: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
    sensitive: z.boolean().optional(),
    durationSecs: z.number().nonnegative().optional(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    sizeBytes: z.number().int().nonnegative().optional(),
    container: z.string().max(20).optional(),
    videoCodec: z.string().max(20).optional(),
    audioCodec: z.string().max(20).optional(),
    frameRate: z.number().positive().optional(),
  })
  .refine(media => (media.width === undefined) === (media.height === undefined), {
    message: 'width and height must be provided together',
  });

/** A resume handle handed back from a previous failed attempt. */
export const resumeHandleSchema = z.object({
  platform: z.string().min(1),
  step: z.string().min(1),
  state: z.record(z.string(), z.unknown()),
  expiresAt: z.string().optional(),
});

export const platformObjectRefSchema = z.object({
  id: z.string().min(1),
  target: targetSchema.optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
});

export const pollInputSchema = z.object({
  options: z.array(z.string().min(1)).min(2),
  durationSecs: z.number().nonnegative().optional(),
  multiple: z.boolean().optional(),
  anonymous: z.boolean().optional(),
});

export const locationInputSchema = z.object({
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  placeId: z.string().optional(),
  name: z.string().optional(),
  address: z.string().optional(),
});

/**
 * The request body of `POST /post` and `POST /preview`.
 */
/** A long-form document: `PostType.ARTICLE` takes one of these, not a body. */
export const articleDocumentSchema = z.object({
  title: z.string().min(1).max(MAX_TITLE_LENGTH),
  subtitle: z.string().max(MAX_TITLE_LENGTH).optional(),
  blocks: z.array(z.looseObject({ type: z.string().min(1) })).min(1),
});

/** One message of a thread. Never produced by splitting a body. */
export const postSegmentSchema = z.object({
  body: z.string().max(MAX_BODY_LIMIT).optional(),
  media: z.array(mediaInputSchema).optional(),
  poll: z.lazy(() => pollInputSchema).optional(),
});

export const postRequestSchema = z.object({
  platform: z.string().min(1),
  target: targetSchema.optional(),
  account: z.string().max(1000).optional(),
  auth: z.record(z.string(), z.unknown()).optional(),
  body: z.string().max(MAX_BODY_LIMIT).optional(),
  bodyFormat: z.string().max(50).optional(),
  type: z.string().optional(),
  title: z.string().max(MAX_TITLE_LENGTH).optional(),
  description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
  tags: z.array(z.string().max(MAX_TAG_LENGTH)).max(MAX_TAGS).optional(),
  language: z.string().max(50).optional(),
  article: articleDocumentSchema.optional(),
  thread: z.array(postSegmentSchema).optional(),
  media: z.array(mediaInputSchema).optional(),
  thumbnail: mediaInputSchema.optional(),
  visibility: z.string().max(50).optional(),
  sensitive: z.boolean().optional(),
  contentWarning: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
  commentsEnabled: z.boolean().optional(),
  inReplyTo: platformObjectRefSchema.optional(),
  repostOf: platformObjectRefSchema.optional(),
  poll: pollInputSchema.optional(),
  location: locationInputSchema.optional(),
  scheduledAt: z.string().max(50).optional(),
  mode: z.enum(['publish', 'draft']).optional(),
  silent: z.boolean().optional(),
  idempotencyKey: z.string().max(500).optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
  resume: resumeHandleSchema.optional(),
});

/** The request body of `POST /status`. */
export const statusRequestSchema = z.object({
  platform: z.string().min(1),
  account: z.string().max(1000).optional(),
  auth: z.record(z.string(), z.unknown()).optional(),
  handle: resumeHandleSchema,
});

/** The request body of `POST /delete`. */
export const deleteRequestSchema = z.object({
  platform: z.string().min(1).optional(),
  account: z.string().max(1000).optional(),
  auth: z.record(z.string(), z.unknown()).optional(),
  ref: z.union([
    z.string(),
    z.number(),
    z.object({
      postId: z.string().optional(),
      target: targetSchema.optional(),
      parts: z
        .array(
          z.object({
            id: z.string(),
            target: targetSchema.optional(),
            url: z.string().optional(),
            kind: z.string().optional(),
          }),
        )
        .optional(),
      extra: z.record(z.string(), z.unknown()).optional(),
    }),
  ]),
  resume: resumeHandleSchema.optional(),
});

/**
 * The metadata half of `POST /post/stream`: the post request itself, minus the
 * media, which arrives as the request body.
 */
export const streamPostRequestSchema = postRequestSchema.omit({ media: true }).extend({
  /** Describes the single media item carried in the body. */
  mediaMeta: z
    .object({
      type: z.enum(['image', 'video', 'audio', 'document']),
      mimeType: z.string().max(255).optional(),
      fileName: z.string().max(255).optional(),
      sizeBytes: z.number().int().nonnegative().optional(),
      altText: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
      durationSecs: z.number().nonnegative().optional(),
      width: z.number().int().positive().optional(),
      height: z.number().int().positive().optional(),
      container: z.string().max(20).optional(),
      videoCodec: z.string().max(20).optional(),
      audioCodec: z.string().max(20).optional(),
      frameRate: z.number().positive().optional(),
    })
    .optional(),
});
