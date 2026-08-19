import { z } from 'zod';
import {
  MAX_BODY_LIMIT,
  MAX_DESCRIPTION_LENGTH,
  MAX_MEDIA_SRC_LENGTH,
  MAX_TAG_LENGTH,
  MAX_TAGS,
  MAX_TITLE_LENGTH,
  PostType,
} from '@bozonx/social-posting';

/** One configured account: a platform, its credentials, and its defaults. */
export const accountSchema = z
  .object({
    platform: z.string().min(1),
    auth: z.record(z.string(), z.unknown()).default({}),
    channelId: z.union([z.string(), z.number()]).optional(),
    maxBody: z.number().int().min(1).max(MAX_BODY_LIMIT).optional(),
  })
  .loose();

/**
 * The shell's configuration file.
 *
 * There is deliberately no retry or idempotency setting: one request makes one
 * attempt, and deduplication needs durable state the shell does not have.
 * See `docs/DELIVERY-SEMANTICS.md`.
 */
export const serverConfigSchema = z.object({
  requestTimeoutSecs: z.number().int().min(1).max(600).default(60),
  accounts: z.record(z.string(), accountSchema).default({}),
});

export type ServerConfig = z.infer<typeof serverConfigSchema>;

/** Media accepted on a request: a source plus per-item options. */
const mediaInputSchema = z
  .object({
    src: z.string().min(1).max(MAX_MEDIA_SRC_LENGTH),
    hasSpoiler: z.boolean().optional(),
    type: z.enum(['image', 'video', 'audio', 'document']).optional(),
    durationSecs: z.number().nonnegative().optional(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
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

/**
 * The request body of `POST /post` and `POST /preview`.
 *
 * Only the structural shape is checked here. What a given network requires is
 * checked by the library against that platform's capability descriptor, so the
 * rules cannot drift between the HTTP and in-process paths.
 */
export const postRequestSchema = z.object({
  platform: z.string().min(1),
  body: z.string().max(MAX_BODY_LIMIT).optional(),
  type: z.enum(PostType).optional(),
  bodyFormat: z.string().max(50).optional(),
  title: z.string().max(MAX_TITLE_LENGTH).optional(),
  description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
  cover: mediaInputSchema.optional(),
  video: mediaInputSchema.optional(),
  audio: mediaInputSchema.optional(),
  document: mediaInputSchema.optional(),
  media: z.array(mediaInputSchema).optional(),
  account: z.string().max(1000).optional(),
  channelId: z.union([z.string().min(1), z.number().int()]).optional(),
  auth: z.record(z.string(), z.unknown()).optional(),
  options: z.record(z.string(), z.unknown()).optional(),
  disableNotification: z.boolean().optional(),
  tags: z.array(z.string().max(MAX_TAG_LENGTH)).max(MAX_TAGS).optional(),
  scheduledAt: z.string().max(50).optional(),
  postLanguage: z.string().max(50).optional(),
  mode: z.enum(['publish', 'draft']).optional(),
  maxBody: z.number().int().min(1).max(MAX_BODY_LIMIT).optional(),
  resume: resumeHandleSchema.optional(),
});

/** The request body of `POST /status`. */
export const statusRequestSchema = z.object({
  platform: z.string().min(1),
  account: z.string().max(1000).optional(),
  auth: z.record(z.string(), z.unknown()).optional(),
  handle: resumeHandleSchema,
});
