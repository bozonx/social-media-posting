import { ErrorCode, PlatformError, PostType, ValidationError } from '@bozonx/social-posting';
import type {
  AccountConfig,
  CredentialProvider,
  ILogger,
  Issue,
  PostRef,
  JsonValue,
  PostRequest,
  ResolvedAccountConfig,
  ResumeHandle,
} from '@bozonx/social-posting';
import {
  MediaFetcher,
  OAuth2TokenRefresher,
  readResumePosition,
  runChunkedUpload,
  toMediaSource,
  validateAgainstCapabilities,
} from '@bozonx/social-posting/platform';
import type {
  CapabilityValidationOptions,
  ChunkedUploadDriver,
  IPlatform,
  OAuth2Config,
  PlatformPublishResponse,
  PlatformStatusResponse,
  PublishOptions,
} from '@bozonx/social-posting/platform';
import { YouTubeApi } from './youtube-api.js';
import type { ResumableSession, YouTubeVideo, YouTubeVideoListResponse } from './youtube-api.js';
import {
  CHUNK_SIZE_BYTES,
  DEFAULT_CATEGORY_ID,
  MAX_THUMBNAIL_BYTES,
  youtubeCapabilities,
} from './capabilities.js';

/** Google's token endpoint, the same for every Google API. */
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

/** The step name a handle from a finished upload carries. */
export const PROCESSING_STEP = 'processing';

/** Collaborators this platform needs, passed explicitly. */
export interface YouTubePlatformDeps {
  logger: ILogger;
  /** Where rotated credentials go back to. Required for unattended uploads. */
  credentialProvider?: CredentialProvider;
  fetch?: typeof fetch;
}

/** Account configuration understood by the YouTube platform. */
export interface YouTubeAccountConfig extends AccountConfig {
  auth: AccountConfig['auth'] & {
    accessToken?: string;
    refreshToken?: string;
  };
  /**
   * The OAuth2 client the tokens were issued to.
   *
   * Part of the account rather than of this package: a host may serve several
   * Google Cloud projects, and the daily quota belongs to the project.
   */
  oauthClient?: { clientId: string; clientSecret?: string };
  /** Category applied when a request states none. */
  defaultCategoryId?: string;
  /**
   * Bytes per chunk. Must be a multiple of 256 KiB — Google's own requirement,
   * and the reason this is validated rather than silently rounded.
   *
   * Worth lowering on a runtime with a request-size ceiling; worth raising on
   * a fat connection, where fewer, larger writes finish sooner.
   */
  chunkSizeBytes?: number;
  /** API request timeout in seconds. */
  apiTimeoutSeconds?: number;
}

/** Platform-specific options a caller may pass in `request.extra`. */
export interface YouTubeExtra {
  categoryId?: string;
  madeForKids?: boolean;
  embeddable?: boolean;
  license?: 'youtube' | 'creativeCommon';
  publicStatsViewable?: boolean;
  notifySubscribers?: boolean;
  recordingDate?: string;
}

const LOG_CONTEXT = 'YouTubePlatform';

/** Processing states `videos.list` reports, and what each one means. */
const TERMINAL_FAILURE_STATES = new Set(['failed', 'terminated']);

/**
 * YouTube, over `videos.insert` and the resumable upload protocol.
 *
 * The shape of this adapter is dictated by one fact: a successful upload is not
 * a published video. `videos.insert` returns an id as soon as the last byte
 * lands, and YouTube then transcodes for anywhere between seconds and hours.
 * So `publish()` returns `processing` with a handle, and the host asks
 * `checkStatus()` until YouTube says the video is playable. Treating the id as
 * proof of publication is how a host reports a video as live while it is still
 * a spinner for every viewer.
 *
 * Shorts get no special path. YouTube classifies a Short from the finished
 * file — its aspect ratio and duration — after the upload, so `shortVideo` and
 * `video` are the same call, and promising otherwise would be promising a
 * classification this adapter does not control.
 */
export class YouTubePlatform implements IPlatform {
  readonly name = 'youtube';
  readonly capabilities = youtubeCapabilities;

  private readonly logger: ILogger;
  private readonly credentialProvider?: CredentialProvider;
  private readonly fetch?: typeof fetch;
  private readonly media: MediaFetcher;
  private readonly refresher?: OAuth2TokenRefresher;

  constructor(deps: YouTubePlatformDeps) {
    this.logger = deps.logger;
    this.credentialProvider = deps.credentialProvider;
    this.fetch = deps.fetch;
    this.media = new MediaFetcher();

    if (deps.credentialProvider) {
      // Built once per platform instance so that two uploads to the same
      // account share the single-flight guard inside it: a rotating refresh
      // token used twice in parallel invalidates itself, and the account is
      // then locked out until a human re-authorizes it.
      this.refresher = new OAuth2TokenRefresher(
        accountConfig => oauthConfigFor(accountConfig),
        deps.credentialProvider,
      );
    }
  }

  async publish(
    request: PostRequest,
    accountConfig: YouTubeAccountConfig & ResolvedAccountConfig,
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

    const accessToken = await this.accessTokenFor(accountConfig, signal);
    const api = this.apiFor(accountConfig);

    const item = request.media?.[0];
    if (!item) {
      throw new ValidationError('YouTube needs exactly one video to upload');
    }
    const source = toMediaSource(item);
    if (source.kind === 'platformRef') {
      throw new ValidationError(
        'YouTube has no re-usable file ids: a video must be uploaded as bytes',
      );
    }

    const metadata = this.buildMetadata(request, accountConfig);
    const probed = await this.media.probe(source, signal);
    const totalBytes = probed.sizeBytes;

    // Where a previous attempt stopped, as YouTube itself reports it. A local
    // offset cannot be trusted after a crash — the last chunk may or may not
    // have landed — and resuming from the wrong byte produces a corrupt file
    // rather than a visible failure.
    const resume = await this.synchronizeResume(
      api,
      options?.resume,
      totalBytes,
      accessToken,
      signal,
    );

    const opened =
      resume === undefined
        ? await this.media.open(source, capabilities, signal)
        : { ...probed, stream: await this.media.openAt(source, resume.offsetBytes, signal) };

    let uploaded: YouTubeVideo | undefined;

    const driver: ChunkedUploadDriver<ResumableSession, YouTubeVideo> = {
      init: async chunkSignal =>
        api.initResumable({
          metadata,
          accessToken,
          contentType: opened.mimeType ?? 'video/*',
          contentLength: totalBytes,
          query: {
            part: 'snippet,status',
            ...(readExtra(request).notifySubscribers === undefined
              ? {}
              : { notifySubscribers: String(readExtra(request).notifySubscribers) }),
          },
          signal: chunkSignal,
        }),

      sendChunk: async context => {
        const video = await api.putChunk({
          session: context.session,
          chunk: context.chunk,
          offsetBytes: context.offsetBytes,
          totalBytes: context.totalBytes,
          accessToken,
          signal: context.signal,
        });
        if (video) {
          // The last chunk carries the created resource. Nothing else will.
          uploaded = video;
        }
      },

      finalize: session => {
        if (uploaded?.id) {
          return Promise.resolve(uploaded);
        }
        throw new PlatformError(
          `YouTube accepted every chunk of session ${session.uploadId} but returned no video resource`,
          ErrorCode.UNKNOWN_OUTCOME,
          { retryable: false },
        );
      },

      serializeSession: session => ({ uploadId: session.uploadId }),
      deserializeSession: state =>
        api.sessionFrom(typeof state.uploadId === 'string' ? state.uploadId : ''),
    };

    const video = await runChunkedUpload(opened.stream, driver, {
      platform: this.name,
      chunkSizeBytes: chunkSizeFor(accountConfig),
      totalBytes,
      resume: resume?.handle,
      signal,
    });

    const videoId = video.id as string;
    await this.applyThumbnail(request, api, videoId, accessToken, signal);

    const ref: PostRef = { postId: videoId, parts: [{ id: videoId, url: watchUrl(videoId) }] };

    return {
      // Never `published`: the file is stored, but nobody can watch it yet.
      status: 'processing',
      postId: videoId,
      url: watchUrl(videoId),
      parts: ref.parts,
      ref,
      handle: {
        version: 1,
        platform: this.name,
        step: PROCESSING_STEP,
        state: { videoId },
      },
      checkAfterMs: (this.capabilities.asyncProcessing?.pollIntervalSecs ?? 30) * 1000,
      raw: sanitizeVideo(video),
    };
  }

  /**
   * Ask whether a video YouTube accepted has finished processing.
   *
   * `processingDetails` is the honest answer: `status.uploadStatus` reads
   * `uploaded` for a file that is still being transcoded, and a host acting on
   * it announces a video its audience cannot play.
   */
  async checkStatus(
    handle: ResumeHandle,
    accountConfig: YouTubeAccountConfig & ResolvedAccountConfig,
    signal?: AbortSignal,
  ): Promise<PlatformStatusResponse> {
    if (handle.platform !== this.name || handle.step !== PROCESSING_STEP) {
      throw new ValidationError(
        `Handle for step "${handle.step}" on "${handle.platform}" is not a YouTube processing handle`,
      );
    }
    const videoId = typeof handle.state.videoId === 'string' ? handle.state.videoId : undefined;
    if (!videoId) {
      throw new ValidationError('YouTube processing handle carries no videoId');
    }

    const accessToken = await this.accessTokenFor(accountConfig, signal);
    const api = this.apiFor(accountConfig);

    const page = await api.call<YouTubeVideoListResponse>({
      url: api.endpoint('/videos', { part: 'status,processingDetails', id: videoId }),
      method: 'GET',
      accessToken,
      signal,
    });

    const video = page?.items?.[0];
    if (!video) {
      // The upload reported an id and the id is now unknown: the video was
      // removed, by moderation or by a human, between the two calls.
      return {
        status: 'failed',
        postId: videoId,
        error: new PlatformError(
          `YouTube no longer knows video ${videoId}; it was removed after upload`,
          ErrorCode.CONTENT_REJECTED,
          { retryable: false },
        ),
      };
    }

    const processing = video.processingDetails?.processingStatus ?? 'processing';
    const failureReason =
      video.processingDetails?.processingFailureReason ??
      video.status?.failureReason ??
      video.status?.rejectionReason;

    if (TERMINAL_FAILURE_STATES.has(processing) || video.status?.uploadStatus === 'rejected') {
      return {
        status: 'failed',
        postId: videoId,
        error: new PlatformError(
          failureReason
            ? `YouTube refused video ${videoId}: ${failureReason}`
            : `YouTube refused video ${videoId}`,
          ErrorCode.CONTENT_REJECTED,
          { retryable: false, platformCode: failureReason },
        ),
        raw: sanitizeVideo(video),
      };
    }

    if (processing === 'succeeded') {
      return {
        status: 'published',
        postId: videoId,
        url: watchUrl(videoId),
        ref: { postId: videoId, parts: [{ id: videoId, url: watchUrl(videoId) }] },
        raw: sanitizeVideo(video),
      };
    }

    return {
      status: 'processing',
      postId: videoId,
      url: watchUrl(videoId),
      checkAfterMs: this.nextCheckMs(video),
      raw: sanitizeVideo(video),
    };
  }

  /** Rules the capability descriptor cannot express. */
  validateExtra(
    request: PostRequest,
    accountConfig: YouTubeAccountConfig,
    type: PostType,
  ): Issue[] {
    const issues: Issue[] = [];
    const extra = readExtra(request);

    const categoryId = extra.categoryId ?? accountConfig.defaultCategoryId;
    if (categoryId !== undefined && !/^[0-9]{1,3}$/.test(categoryId)) {
      issues.push({
        code: 'INVALID_CATEGORY_ID',
        field: 'extra.categoryId',
        message: 'YouTube category ids are numeric strings such as "22"',
      });
    }

    if (request.scheduledAt !== undefined) {
      // `status.publishAt` is honoured only while the video is private; on a
      // public video YouTube ignores it silently, which is the worst outcome.
      const visibility = request.visibility ?? this.capabilities.defaultVisibility;
      if (visibility !== 'private') {
        issues.push({
          code: 'SCHEDULE_REQUIRES_PRIVATE',
          field: 'scheduledAt',
          message:
            'YouTube honours a scheduled publish time only on a private video; set visibility to "private" alongside scheduledAt',
        });
      }
      if (Number.isNaN(Date.parse(request.scheduledAt))) {
        issues.push({
          code: 'INVALID_SCHEDULED_AT',
          field: 'scheduledAt',
          message: 'Field "scheduledAt" must be an ISO 8601 timestamp',
        });
      }
    }

    if (request.mode === 'draft') {
      issues.push({
        code: 'DRAFT_UNSUPPORTED',
        field: 'mode',
        message:
          'YouTube has no draft: a private video is uploaded, stored and has already cost its quota. Set visibility to "private" if that is what was meant.',
      });
    }

    if (extra.recordingDate !== undefined && Number.isNaN(Date.parse(extra.recordingDate))) {
      issues.push({
        code: 'INVALID_RECORDING_DATE',
        field: 'extra.recordingDate',
        message: 'Field "extra.recordingDate" must be an ISO 8601 date',
      });
    }

    const thumbnailSize = request.thumbnail?.sizeBytes;
    if (thumbnailSize !== undefined && thumbnailSize > MAX_THUMBNAIL_BYTES) {
      issues.push({
        code: 'THUMBNAIL_TOO_LARGE',
        field: 'thumbnail',
        message: `A YouTube thumbnail may not exceed ${MAX_THUMBNAIL_BYTES} bytes`,
      });
    }

    if (type === PostType.SHORT_VIDEO) {
      const video = request.media?.[0];
      // Advisory rather than an error: the rules for what counts as a Short
      // belong to the product and change without an API version, so refusing
      // here would reject uploads YouTube itself would have accepted.
      if (video?.width !== undefined && video.height !== undefined && video.width > video.height) {
        this.logger.warn(
          'A landscape video was submitted as shortVideo; YouTube classifies Shorts from the finished file and will most likely publish this as an ordinary video',
          LOG_CONTEXT,
        );
      }
    }

    return issues;
  }

  private validationHooks(accountConfig: YouTubeAccountConfig): CapabilityValidationOptions {
    return {
      target: undefined,
      validateExtra: (candidate: PostRequest, type: PostType) =>
        this.validateExtra(candidate, accountConfig, type),
    };
  }

  private apiFor(accountConfig: YouTubeAccountConfig): YouTubeApi {
    return new YouTubeApi({
      baseUrl: accountConfig.apiBaseUrl,
      timeoutSeconds: accountConfig.apiTimeoutSeconds,
      fetch: this.fetch,
    });
  }

  /**
   * A token that will still be valid when the upload starts.
   *
   * Refreshing up front rather than on a 401 matters here more than elsewhere:
   * an upload can run for an hour, which is the whole life of a Google access
   * token, and discovering that halfway through means discarding the bytes
   * already sent.
   */
  private async accessTokenFor(
    accountConfig: YouTubeAccountConfig & ResolvedAccountConfig,
    signal?: AbortSignal,
  ): Promise<string> {
    const stored = accountConfig.auth.accessToken;

    if (this.refresher && accountConfig.accountRef && accountConfig.oauthClient) {
      const fresh = await this.refresher.ensureFresh(
        accountConfig.accountRef,
        accountConfig.auth,
        signal,
        accountConfig,
      );
      if (typeof fresh.accessToken === 'string' && fresh.accessToken.length > 0) {
        return fresh.accessToken;
      }
    }

    if (typeof stored !== 'string' || stored.length === 0) {
      throw new PlatformError(
        'This YouTube account carries no access token',
        ErrorCode.AUTH_ERROR,
        { retryable: false },
      );
    }
    return stored;
  }

  /**
   * Reconcile a stored resume handle with what YouTube actually holds.
   *
   * @returns The handle to continue from, or undefined to start a new session.
   */
  private async synchronizeResume(
    api: YouTubeApi,
    handle: ResumeHandle | undefined,
    totalBytes: number | undefined,
    accessToken: string,
    signal?: AbortSignal,
  ): Promise<{ handle: ResumeHandle; offsetBytes: number } | undefined> {
    const position = readResumePosition(handle, this.name);
    if (!position || handle === undefined) {
      return undefined;
    }

    const uploadId = position.state.uploadId;
    if (typeof uploadId !== 'string' || uploadId.length === 0 || totalBytes === undefined) {
      // Without a session id, or without a known total, there is nothing to
      // ask YouTube about. Starting over costs the upload, not a second video:
      // the previous session expires unused.
      return undefined;
    }

    const session = api.sessionFrom(uploadId);
    const outcome = await api.queryPosition({ session, totalBytes, accessToken, signal });

    if (outcome.status === 'complete') {
      throw new PlatformError(
        'The interrupted YouTube upload had already completed; check the channel rather than uploading again',
        ErrorCode.UNKNOWN_OUTCOME,
        { retryable: false, resumeHandle: handle },
      );
    }

    if (outcome.offsetBytes !== position.offsetBytes) {
      this.logger.warn(
        `Resuming a YouTube upload from byte ${outcome.offsetBytes}, not the ${position.offsetBytes} the handle recorded`,
        LOG_CONTEXT,
      );
    }

    return {
      handle: { ...handle, state: { ...position.state, offsetBytes: outcome.offsetBytes } },
      offsetBytes: outcome.offsetBytes,
    };
  }

  /**
   * Set a custom thumbnail, if one was asked for.
   *
   * Failure is logged, not thrown: the video is uploaded and its quota is
   * spent, and turning a missing thumbnail into a failed publication would
   * make the host re-upload a video that already exists.
   */
  private async applyThumbnail(
    request: PostRequest,
    api: YouTubeApi,
    videoId: string,
    accessToken: string,
    signal?: AbortSignal,
  ): Promise<void> {
    if (!request.thumbnail) {
      return;
    }

    try {
      const opened = await this.media.open(
        toMediaSource({ ...request.thumbnail, type: 'image' }),
        undefined,
        signal,
      );
      const bytes = new Uint8Array(await new Response(opened.stream).arrayBuffer());
      if (bytes.byteLength > MAX_THUMBNAIL_BYTES) {
        throw new ValidationError(
          `A YouTube thumbnail may not exceed ${MAX_THUMBNAIL_BYTES} bytes`,
        );
      }

      await api.call({
        url: api.uploadEndpoint('/thumbnails/set', { videoId, uploadType: 'media' }),
        method: 'POST',
        accessToken,
        body: bytes,
        contentType: opened.mimeType ?? 'image/jpeg',
        signal,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Video ${videoId} was uploaded but its thumbnail was refused: ${message}`,
        LOG_CONTEXT,
      );
    }
  }

  /** The video resource `videos.insert` is given. */
  private buildMetadata(
    request: PostRequest,
    accountConfig: YouTubeAccountConfig,
  ): Record<string, unknown> {
    const extra = readExtra(request);

    const snippet: Record<string, unknown> = {
      title: request.title,
      // The body is the description: YouTube has no second text field, and
      // dropping it would silently discard the post's text.
      description: request.description ?? request.body ?? '',
      categoryId: extra.categoryId ?? accountConfig.defaultCategoryId ?? DEFAULT_CATEGORY_ID,
    };
    if (request.tags?.length) {
      snippet.tags = request.tags;
    }
    if (request.language) {
      snippet.defaultLanguage = request.language;
      snippet.defaultAudioLanguage = request.language;
    }

    const status: Record<string, unknown> = {
      privacyStatus: request.visibility ?? this.capabilities.defaultVisibility ?? 'private',
    };
    if (extra.madeForKids !== undefined) {
      // YouTube requires an explicit answer per video; there is no account
      // default the API will apply on our behalf.
      status.selfDeclaredMadeForKids = extra.madeForKids;
    }
    if (extra.embeddable !== undefined) {
      status.embeddable = extra.embeddable;
    }
    if (extra.license !== undefined) {
      status.license = extra.license;
    }
    if (extra.publicStatsViewable !== undefined) {
      status.publicStatsViewable = extra.publicStatsViewable;
    }
    if (request.scheduledAt !== undefined) {
      status.publishAt = new Date(request.scheduledAt).toISOString();
    }

    const metadata: Record<string, unknown> = { snippet, status };
    if (extra.recordingDate !== undefined) {
      metadata.recordingDetails = { recordingDate: new Date(extra.recordingDate).toISOString() };
    }
    return metadata;
  }

  /** How long to wait before asking again, using YouTube's own estimate when it gives one. */
  private nextCheckMs(video: YouTubeVideo): number {
    const fallback = (this.capabilities.asyncProcessing?.pollIntervalSecs ?? 30) * 1000;
    const timeLeft = Number(video.processingDetails?.processingProgress?.timeLeftMs);
    if (!Number.isFinite(timeLeft) || timeLeft <= 0) {
      return fallback;
    }
    // Never faster than the fallback: an optimistic estimate from YouTube is
    // not a reason to spend quota on a tighter poll loop.
    return Math.max(fallback, Math.min(timeLeft, 10 * 60 * 1000));
  }
}

/** The OAuth2 configuration for one account, built from what the account carries. */
function oauthConfigFor(accountConfig: AccountConfig): OAuth2Config {
  const client = (accountConfig as YouTubeAccountConfig).oauthClient;
  if (!client?.clientId) {
    throw new PlatformError(
      'Refreshing a YouTube token needs the account to carry its oauthClient.clientId',
      ErrorCode.AUTH_ERROR,
      { retryable: false },
    );
  }
  return {
    tokenEndpoint: GOOGLE_TOKEN_ENDPOINT,
    clientId: client.clientId,
    ...(client.clientSecret === undefined ? {} : { clientSecret: client.clientSecret }),
  };
}

/** Google's resumable protocol accepts only multiples of 256 KiB per chunk. */
const CHUNK_MULTIPLE_BYTES = 256 * 1024;

function chunkSizeFor(accountConfig: YouTubeAccountConfig): number {
  const configured = accountConfig.chunkSizeBytes;
  if (configured === undefined) {
    return CHUNK_SIZE_BYTES;
  }
  if (configured <= 0 || configured % CHUNK_MULTIPLE_BYTES !== 0) {
    throw new ValidationError(
      `Account "chunkSizeBytes" must be a positive multiple of ${CHUNK_MULTIPLE_BYTES} bytes; YouTube refuses anything else`,
    );
  }
  return configured;
}

function readExtra(request: PostRequest): YouTubeExtra {
  return request.extra ?? {};
}

function watchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

/**
 * The parts of a video resource that are safe to hand back and to log.
 *
 * `raw` reaches the host's database and its logs. A YouTube video resource is
 * mostly harmless, but it is echoed back from a request that contained a
 * session URL, and copying the whole object wholesale is how one ends up
 * stored next to the post.
 */
function sanitizeVideo(video: YouTubeVideo): JsonValue {
  return {
    id: video.id ?? null,
    uploadStatus: video.status?.uploadStatus ?? null,
    privacyStatus: video.status?.privacyStatus ?? null,
    processingStatus: video.processingDetails?.processingStatus ?? null,
  };
}
