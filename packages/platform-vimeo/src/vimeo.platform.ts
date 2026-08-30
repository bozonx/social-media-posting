import { ErrorCode, PlatformError, ValidationError } from '@bozonx/social-posting';
import type {
  AccountConfig,
  ILogger,
  Issue,
  JsonValue,
  PostRef,
  PostRequest,
  PostType,
  QuotaState,
  ResolvedAccountConfig,
  ResumeHandle,
} from '@bozonx/social-posting';
import {
  MediaFetcher,
  readResumePosition,
  runChunkedUpload,
  toMediaSource,
  validateAgainstCapabilities,
} from '@bozonx/social-posting/platform';
import type {
  CapabilityValidationOptions,
  ChunkedUploadDriver,
  IPlatform,
  PlatformPublishResponse,
  PlatformStatusResponse,
  PublishOptions,
} from '@bozonx/social-posting/platform';
import { VimeoApi, videoIdOf } from './vimeo-api.js';
import type { VimeoUploadQuota, VimeoVideo } from './vimeo-api.js';
import { CHUNK_SIZE_BYTES, vimeoCapabilities } from './capabilities.js';

/** The step name a handle from a finished upload carries. */
export const PROCESSING_STEP = 'processing';

/** Collaborators this platform needs, passed explicitly. */
export interface VimeoPlatformDeps {
  logger: ILogger;
  fetch?: typeof fetch;
}

/** Account configuration understood by the Vimeo platform. */
export interface VimeoAccountConfig extends AccountConfig {
  auth: AccountConfig['auth'] & { accessToken?: string };
  /** Upload approach applied when a request states none. Defaults to `tus`. */
  defaultUploadApproach?: 'tus' | 'pull';
  /** Bytes per tus write. Lower it on a runtime with a request-size ceiling. */
  chunkSizeBytes?: number;
  /** API request timeout in seconds. */
  apiTimeoutSeconds?: number;
}

/** Platform-specific options a caller may pass in `request.extra`. */
export interface VimeoExtra {
  uploadApproach?: 'tus' | 'pull';
  privacyView?: 'anybody' | 'nobody' | 'unlisted' | 'contacts' | 'password' | 'disable';
  password?: string;
  folderUri?: string;
  license?: string;
  contentRating?: string[];
}

const LOG_CONTEXT = 'VimeoPlatform';

/** Vimeo's own name for each of the library's visibility values. */
const PRIVACY_BY_VISIBILITY: Record<string, string> = {
  public: 'anybody',
  unlisted: 'unlisted',
  private: 'nobody',
};

/**
 * Vimeo, over tus uploads and the pull approach.
 *
 * What separates this from YouTube is not the protocol — both are resumable
 * offset uploads — but what runs out. YouTube spends daily operation units;
 * Vimeo spends storage and a weekly allowance set by the account's plan. Both
 * surface as `QUOTA_EXCEEDED`, and a host that shows one message for both tells
 * half its users to wait for a reset that will never come.
 *
 * The other difference is that `pull` is genuine here: Vimeo will fetch a URL
 * itself. That saves the host's bandwidth and costs it the ability to resume,
 * report progress, or learn about a broken link before transcoding fails.
 */
export class VimeoPlatform implements IPlatform {
  readonly name = 'vimeo';
  readonly capabilities = vimeoCapabilities;

  private readonly logger: ILogger;
  private readonly fetch?: typeof fetch;
  private readonly media: MediaFetcher;

  constructor(deps: VimeoPlatformDeps) {
    this.logger = deps.logger;
    this.fetch = deps.fetch;
    this.media = new MediaFetcher();
  }

  async publish(
    request: PostRequest,
    accountConfig: VimeoAccountConfig & ResolvedAccountConfig,
    options?: PublishOptions,
  ): Promise<PlatformPublishResponse> {
    const signal = options?.signal;
    if (signal?.aborted) {
      throw new PlatformError('Request aborted before publishing', ErrorCode.NETWORK_ERROR, {
        retryable: false,
      });
    }

    const capabilities = options?.capabilities ?? this.capabilities;
    const { issues, warnings, detectedType } = validateAgainstCapabilities(
      request,
      capabilities,
      this.validationHooks(accountConfig),
    );
    if (issues.length > 0) {
      throw new ValidationError(issues);
    }
    if (warnings.length > 0) {
      this.logger.warn(
        `Warnings during publish (type: ${detectedType}): ${warnings.map(w => w.message).join('; ')}`,
        LOG_CONTEXT,
      );
    }

    const accessToken = requireAccessToken(accountConfig);
    const api = this.apiFor(accountConfig);

    const item = request.media?.[0];
    if (!item) {
      throw new ValidationError('Vimeo needs exactly one video to upload');
    }
    const source = toMediaSource(item);
    if (source.kind === 'platformRef') {
      throw new ValidationError('Vimeo has no re-usable file ids: a video must be uploaded');
    }

    const approach = this.approachFor(request, accountConfig, source.kind);

    return approach === 'pull'
      ? this.publishByPull(request, accountConfig, api, accessToken, signal)
      : this.publishByTus(request, accountConfig, api, accessToken, options);
  }

  /**
   * Hand Vimeo a URL and let it fetch the file.
   *
   * One call, no bytes through this process, and no resumability: if Vimeo
   * cannot reach the link, the failure arrives minutes later as a transcode
   * error rather than as a response to this request. Which is why the
   * descriptor states how long the URL must stay alive.
   */
  private async publishByPull(
    request: PostRequest,
    accountConfig: VimeoAccountConfig,
    api: VimeoApi,
    accessToken: string,
    signal?: AbortSignal,
  ): Promise<PlatformPublishResponse> {
    const source = toMediaSource(request.media?.[0] as NonNullable<PostRequest['media']>[number]);
    if (source.kind !== 'url') {
      throw new ValidationError(
        'The Vimeo pull approach needs a media item with a `url` source; raw bytes have no link for Vimeo to fetch',
      );
    }

    const video = await api.call<VimeoVideo>({
      url: api.endpoint('/me/videos'),
      method: 'POST',
      accessToken,
      body: {
        ...this.buildMetadata(request, accountConfig),
        upload: { approach: 'pull', link: source.url },
      },
      signal,
    });

    return this.processingResponse(video, 'pull');
  }

  /** Push the bytes ourselves, one resumable chunk at a time. */
  private async publishByTus(
    request: PostRequest,
    accountConfig: VimeoAccountConfig,
    api: VimeoApi,
    accessToken: string,
    options?: PublishOptions,
  ): Promise<PlatformPublishResponse> {
    const signal = options?.signal;
    const source = toMediaSource(request.media?.[0] as NonNullable<PostRequest['media']>[number]);
    if (source.kind === 'platformRef') {
      throw new ValidationError('Vimeo has no re-usable file ids');
    }

    const probed = await this.media.probe(source, signal);
    const totalBytes = probed.sizeBytes;
    if (totalBytes === undefined) {
      // tus needs the size up front: Vimeo reserves the storage before the
      // first byte and refuses an open-ended upload.
      throw new ValidationError(
        'Vimeo needs the size of the video before the upload starts; supply `sizeBytes` on the media item or use a source whose length is known',
      );
    }

    const resumed = await this.reopenSession(api, options?.resume, accessToken, signal);

    const opened =
      resumed === undefined
        ? await this.media.open(source, options?.capabilities ?? this.capabilities, signal)
        : { ...probed, stream: await this.media.openAt(source, resumed.offsetBytes, signal) };

    // The created resource, captured at `init` so `finalize` can return it: the
    // tus endpoint answers with headers only and never names the video.
    let created: VimeoVideo | undefined = resumed?.video;

    const driver: ChunkedUploadDriver<{ uploadLink: string; videoUri: string }, VimeoVideo> = {
      init: async initSignal => {
        if (resumed) {
          return { uploadLink: resumed.uploadLink, videoUri: resumed.videoUri };
        }
        const video = await api.call<VimeoVideo>({
          url: api.endpoint('/me/videos'),
          method: 'POST',
          accessToken,
          body: {
            ...this.buildMetadata(request, accountConfig),
            upload: { approach: 'tus', size: String(totalBytes) },
          },
          signal: initSignal,
        });

        const uploadLink = video?.upload?.upload_link;
        const videoUri = video?.uri;
        if (!uploadLink || !videoUri) {
          throw new PlatformError(
            'Vimeo created the video but returned no tus upload link',
            ErrorCode.PLATFORM_ERROR,
            { retryable: true },
          );
        }
        created = video;
        return { uploadLink, videoUri };
      },

      sendChunk: async context => {
        await api.tusPatch({
          uploadLink: context.session.uploadLink,
          chunk: context.chunk,
          offsetBytes: context.offsetBytes,
          signal: context.signal,
        });
      },

      finalize: session => Promise.resolve(created?.uri ? created : { uri: session.videoUri }),

      // The upload link is a bearer URL: whoever holds it can write to the
      // video. It is deliberately absent from the handle, and re-read from
      // `GET /videos/{id}` on resume — the one call that makes it safe to
      // store progress in a host's database.
      serializeSession: session => ({ videoUri: session.videoUri }),
      deserializeSession: state => ({
        videoUri: typeof state.videoUri === 'string' ? state.videoUri : '',
        uploadLink: resumed?.uploadLink ?? '',
      }),
    };

    const video = await runChunkedUpload(opened.stream, driver, {
      platform: this.name,
      chunkSizeBytes: accountConfig.chunkSizeBytes ?? CHUNK_SIZE_BYTES,
      totalBytes,
      resume: resumed?.handle,
      signal,
    });

    return this.processingResponse(video, 'tus');
  }

  /**
   * Ask whether an uploaded video has finished transcoding.
   *
   * `transcode.status` rather than `status`: a video reads `available` while
   * its highest-quality rendition is still being produced, and acting on that
   * announces a video that plays badly or not at all.
   */
  async checkStatus(
    handle: ResumeHandle,
    accountConfig: VimeoAccountConfig & ResolvedAccountConfig,
    signal?: AbortSignal,
  ): Promise<PlatformStatusResponse> {
    if (handle.platform !== this.name || handle.step !== PROCESSING_STEP) {
      throw new ValidationError(
        `Handle for step "${handle.step}" on "${handle.platform}" is not a Vimeo processing handle`,
      );
    }
    const videoUri = typeof handle.state.videoUri === 'string' ? handle.state.videoUri : undefined;
    if (!videoUri) {
      throw new ValidationError('Vimeo processing handle carries no videoUri');
    }

    const accessToken = requireAccessToken(accountConfig);
    const api = this.apiFor(accountConfig);

    const video = await api.call<VimeoVideo>({
      url: api.endpoint(videoUri, { fields: 'uri,link,status,transcode,upload' }),
      method: 'GET',
      accessToken,
      signal,
    });

    if (!video) {
      return {
        status: 'failed',
        error: new PlatformError(
          `Vimeo no longer knows ${videoUri}; the video was removed after upload`,
          ErrorCode.CONTENT_REJECTED,
          { retryable: false },
        ),
      };
    }

    const transcode = video.transcode?.status;
    const upload = video.upload?.status;
    const id = videoIdOf(video.uri ?? videoUri);

    if (transcode === 'error' || upload === 'error' || video.status === 'transcoding_error') {
      return {
        status: 'failed',
        postId: id,
        error: new PlatformError(
          `Vimeo could not transcode ${videoUri}`,
          ErrorCode.CONTENT_REJECTED,
          { retryable: false, platformCode: transcode ?? upload },
        ),
        raw: sanitizeVideo(video),
      };
    }

    if (transcode === 'complete') {
      const url = video.link;
      return {
        status: 'published',
        postId: id,
        url,
        ref: {
          postId: id ?? videoUri,
          parts: id === undefined ? undefined : [{ id, url }],
          extra: { videoUri },
        },
        raw: sanitizeVideo(video),
      };
    }

    return {
      status: 'processing',
      postId: id,
      url: video.link,
      checkAfterMs: (this.capabilities.asyncProcessing?.pollIntervalSecs ?? 20) * 1000,
      raw: sanitizeVideo(video),
    };
  }

  /**
   * What this account has left, in bytes.
   *
   * Reported as `bytes` rather than as an operation count on purpose: it is
   * what makes a host able to say "free up space" instead of "try again
   * tomorrow", which is the wrong advice on Vimeo and the right one on YouTube.
   */
  async getQuota(
    accountConfig: VimeoAccountConfig & ResolvedAccountConfig,
    signal?: AbortSignal,
  ): Promise<QuotaState> {
    const accessToken = requireAccessToken(accountConfig);
    const api = this.apiFor(accountConfig);

    const me = await api.call<{ upload_quota?: VimeoUploadQuota }>({
      url: api.endpoint('/me', { fields: 'upload_quota' }),
      method: 'GET',
      accessToken,
      signal,
    });

    const quota = me?.upload_quota;
    // The tighter of the two is the one that will actually stop an upload:
    // a plan with room left can still be out of its weekly allowance.
    const space = quota?.space;
    const periodic = quota?.periodic;
    const useperiodic =
      periodic?.free !== undefined && (space?.free === undefined || periodic.free < space.free);
    const chosen = useperiodic ? periodic : space;

    return {
      unit: 'bytes',
      ...(chosen?.free === undefined ? {} : { remaining: chosen.free }),
      ...(chosen?.max === undefined ? {} : { limit: chosen.max }),
      ...(useperiodic && periodic.reset_date ? { resetsAt: periodic.reset_date } : {}),
      fetchedAt: new Date().toISOString(),
      raw: quota,
    };
  }

  /** Rules the capability descriptor cannot express. */
  validateExtra(request: PostRequest, accountConfig: VimeoAccountConfig, _type: PostType): Issue[] {
    const issues: Issue[] = [];
    const extra = readExtra(request);

    if (extra.privacyView === 'password' && !extra.password) {
      issues.push({
        code: 'PASSWORD_REQUIRED',
        field: 'extra.password',
        message: 'Vimeo privacy mode "password" needs `extra.password`',
      });
    }

    if (extra.privacyView !== undefined && request.visibility !== undefined) {
      // Both set the same field on the video. Silently letting one win means
      // publishing at a visibility nobody asked for.
      issues.push({
        code: 'CONFLICTING_PRIVACY',
        field: 'extra.privacyView',
        message:
          'Set either `visibility` or `extra.privacyView`, not both: they write the same Vimeo field',
      });
    }

    const approachRequested = extra.uploadApproach ?? accountConfig.defaultUploadApproach;
    if (approachRequested === 'pull') {
      const source = request.media?.[0]?.source;
      if (source && source.kind !== 'url') {
        issues.push({
          code: 'PULL_NEEDS_URL',
          field: 'media',
          message:
            'The Vimeo pull approach needs a media item with a `url` source; there is no link for Vimeo to fetch',
        });
      }
    }

    return issues;
  }

  private validationHooks(accountConfig: VimeoAccountConfig): CapabilityValidationOptions {
    return {
      target: undefined,
      validateExtra: (candidate: PostRequest, type: PostType) =>
        this.validateExtra(candidate, accountConfig, type),
    };
  }

  private apiFor(accountConfig: VimeoAccountConfig): VimeoApi {
    return new VimeoApi({
      baseUrl: accountConfig.apiBaseUrl,
      timeoutSeconds: accountConfig.apiTimeoutSeconds,
      fetch: this.fetch,
    });
  }

  private approachFor(
    request: PostRequest,
    accountConfig: VimeoAccountConfig,
    sourceKind: string,
  ): 'tus' | 'pull' {
    const requested = readExtra(request).uploadApproach ?? accountConfig.defaultUploadApproach;
    if (requested === 'pull' && sourceKind !== 'url') {
      throw new ValidationError('The Vimeo pull approach needs a media item with a `url` source');
    }
    return requested ?? 'tus';
  }

  /**
   * Re-open an interrupted tus session.
   *
   * The upload link is fetched again from the video rather than read out of the
   * handle, and the offset comes from the tus endpoint rather than from the
   * handle's own count. Both for the same reason: what the host stored is what
   * was true before the process died, and only Vimeo knows what actually landed.
   */
  private async reopenSession(
    api: VimeoApi,
    handle: ResumeHandle | undefined,
    accessToken: string,
    signal?: AbortSignal,
  ): Promise<
    | {
        handle: ResumeHandle;
        uploadLink: string;
        videoUri: string;
        offsetBytes: number;
        video: VimeoVideo;
      }
    | undefined
  > {
    const position = readResumePosition(handle, this.name);
    if (!position || handle === undefined) {
      return undefined;
    }
    const videoUri = position.state.videoUri;
    if (typeof videoUri !== 'string' || videoUri.length === 0) {
      return undefined;
    }

    const video = await api.call<VimeoVideo>({
      url: api.endpoint(videoUri, { fields: 'uri,link,status,transcode,upload' }),
      method: 'GET',
      accessToken,
      signal,
    });

    const uploadLink = video?.upload?.upload_link;
    if (!video || !uploadLink) {
      // Either the video is gone or its upload already completed. Starting a
      // fresh upload would be the wrong repair for the second case, so the
      // caller is told rather than guessed for.
      throw new PlatformError(
        `The interrupted Vimeo upload for ${videoUri} has no open session left; check the account before uploading again`,
        ErrorCode.UNKNOWN_OUTCOME,
        { retryable: false, resumeHandle: handle },
      );
    }

    const offsetBytes = await api.tusOffset(uploadLink, signal);
    if (offsetBytes !== position.offsetBytes) {
      this.logger.warn(
        `Resuming a Vimeo upload from byte ${offsetBytes}, not the ${position.offsetBytes} the handle recorded`,
        LOG_CONTEXT,
      );
    }

    return {
      handle: { ...handle, state: { ...position.state, offsetBytes } },
      uploadLink,
      videoUri,
      offsetBytes,
      video,
    };
  }

  /** The video resource fields Vimeo takes on create. */
  private buildMetadata(
    request: PostRequest,
    _accountConfig: VimeoAccountConfig,
  ): Record<string, unknown> {
    const extra = readExtra(request);
    const body: Record<string, unknown> = {};

    if (request.title !== undefined) {
      body.name = request.title;
    }
    const description = request.description ?? request.body;
    if (description !== undefined) {
      body.description = description;
    }
    if (request.tags?.length) {
      body.tags = request.tags.map(name => ({ name }));
    }

    const view =
      extra.privacyView ??
      PRIVACY_BY_VISIBILITY[
        request.visibility ?? this.capabilities.defaultVisibility ?? 'unlisted'
      ];
    const privacy: Record<string, unknown> = { view };
    if (extra.privacyView === 'password' && extra.password !== undefined) {
      body.password = extra.password;
    }
    body.privacy = privacy;

    if (extra.folderUri !== undefined) {
      body.folder_uri = extra.folderUri;
    }
    if (extra.license !== undefined) {
      body.license = extra.license;
    }
    if (extra.contentRating !== undefined) {
      body.content_rating = extra.contentRating;
    }

    return body;
  }

  /** The common answer for a video Vimeo has accepted but not yet transcoded. */
  private processingResponse(
    video: VimeoVideo | undefined,
    approach: 'tus' | 'pull',
  ): PlatformPublishResponse {
    const videoUri = video?.uri;
    if (!videoUri) {
      throw new PlatformError(
        'Vimeo accepted the upload but returned no video URI',
        ErrorCode.UNKNOWN_OUTCOME,
        { retryable: false },
      );
    }

    const id = videoIdOf(videoUri) ?? videoUri;
    const url = video.link;
    const ref: PostRef = {
      postId: id,
      parts: [{ id, url }],
      extra: { videoUri },
    };

    return {
      status: 'processing',
      postId: id,
      url,
      parts: ref.parts,
      ref,
      handle: {
        version: 1,
        platform: this.name,
        step: PROCESSING_STEP,
        state: { videoUri, approach },
      },
      checkAfterMs: (this.capabilities.asyncProcessing?.pollIntervalSecs ?? 20) * 1000,
      raw: sanitizeVideo(video),
    };
  }
}

function readExtra(request: PostRequest): VimeoExtra {
  return request.extra ?? {};
}

function requireAccessToken(accountConfig: VimeoAccountConfig): string {
  const token = accountConfig.auth.accessToken;
  if (typeof token !== 'string' || token.length === 0) {
    throw new PlatformError('This Vimeo account carries no access token', ErrorCode.AUTH_ERROR, {
      retryable: false,
    });
  }
  return token;
}

/**
 * The parts of a video resource that are safe to hand back and to log.
 *
 * `upload.upload_link` is a bearer URL: anyone holding it can write bytes into
 * this video. It must not reach `raw`, which the host stores next to the post
 * and prints in its logs.
 */
function sanitizeVideo(video: VimeoVideo): JsonValue {
  return {
    uri: video.uri ?? null,
    link: video.link ?? null,
    status: video.status ?? null,
    transcodeStatus: video.transcode?.status ?? null,
    uploadStatus: video.upload?.status ?? null,
  };
}
