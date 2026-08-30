import { ErrorCode, PlatformError, ValidationError } from '@bozonx/social-posting';
import type {
  AccountConfig,
  CredentialProvider,
  ILogger,
  Issue,
  JsonValue,
  PostRef,
  PostRequest,
  PostType,
  ResolvedAccountConfig,
  ResumeHandle,
} from '@bozonx/social-posting';
import {
  MediaFetcher,
  OAuth2TokenRefresher,
  toMediaSource,
  validateAgainstCapabilities,
} from '@bozonx/social-posting/platform';
import type {
  CapabilityValidationOptions,
  IPlatform,
  OAuth2Config,
  PlatformPublishResponse,
  PlatformStatusResponse,
  PublishOptions,
} from '@bozonx/social-posting/platform';
import { DailymotionApi, TOKEN_ENDPOINT } from './dailymotion-api.js';
import type { DailymotionVideo } from './dailymotion-api.js';
import { dailymotionCapabilities } from './capabilities.js';

/** The step name a handle from a finished upload carries. */
export const PROCESSING_STEP = 'processing';

/** Collaborators this platform needs, passed explicitly. */
export interface DailymotionPlatformDeps {
  logger: ILogger;
  /** Where rotated credentials go back to. Required for unattended uploads. */
  credentialProvider?: CredentialProvider;
  fetch?: typeof fetch;
}

/** Account configuration understood by the Dailymotion platform. */
export interface DailymotionAccountConfig extends AccountConfig {
  auth: AccountConfig['auth'] & { accessToken?: string; refreshToken?: string };
  /** The OAuth2 client the tokens were issued to. */
  oauthClient?: { clientId: string; clientSecret?: string };
  /** Content category applied when a request states none. */
  defaultChannel?: string;
  /** API request timeout in seconds. */
  apiTimeoutSeconds?: number;
}

/** Platform-specific options a caller may pass in `request.extra`. */
export interface DailymotionExtra {
  channel?: string;
  isCreatedForKids?: boolean;
  isExplicit?: boolean;
  geoblocking?: string[];
  playerNextVideos?: string[];
}

const LOG_CONTEXT = 'DailymotionPlatform';

/** Statuses that mean Dailymotion will never publish this video. */
const TERMINAL_FAILURE_STATES = new Set(['encoding_error', 'rejected', 'deleted']);

/**
 * Dailymotion, over its three-step upload.
 *
 * Ask for a signed upload URL, POST the file to it, then create the video by
 * pointing at what was uploaded. The steps are separate calls, but only the
 * last one is idempotent-ish: the upload itself is a single `POST` with no
 * offset protocol, so an interrupted upload starts over. This adapter says so
 * rather than pretending — `runChunkedUpload` is not used here, and no resume
 * handle is issued for the upload step, because a handle that cannot actually
 * resume is worse than none.
 *
 * What it does issue is a handle for the *encoding*, which is asynchronous like
 * every other video network in the set.
 */
export class DailymotionPlatform implements IPlatform {
  readonly name = 'dailymotion';
  readonly capabilities = dailymotionCapabilities;

  private readonly logger: ILogger;
  private readonly fetch?: typeof fetch;
  private readonly media: MediaFetcher;
  private readonly refresher?: OAuth2TokenRefresher;

  constructor(deps: DailymotionPlatformDeps) {
    this.logger = deps.logger;
    this.fetch = deps.fetch;
    this.media = new MediaFetcher();

    if (deps.credentialProvider) {
      this.refresher = new OAuth2TokenRefresher(
        accountConfig => oauthConfigFor(accountConfig),
        deps.credentialProvider,
      );
    }
  }

  async publish(
    request: PostRequest,
    accountConfig: DailymotionAccountConfig & ResolvedAccountConfig,
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
      throw new ValidationError('Dailymotion needs exactly one video to upload');
    }
    const source = toMediaSource(item);
    if (source.kind === 'platformRef') {
      throw new ValidationError('Dailymotion has no re-usable file ids: a video must be uploaded');
    }

    // Step 1. The ticket is single-use and short-lived, so it is fetched here
    // rather than anywhere it could be cached.
    const ticket = await api.requestUploadTicket(accessToken, signal);

    // Step 2. The upload endpoint takes one multipart POST, so the file is
    // materialized. The size ceiling was already enforced against the
    // descriptor, which is what keeps this bounded.
    const opened = await this.media.open(source, capabilities, signal);
    const blob = await new Response(opened.stream).blob();
    const fileUrl = await api.uploadFile({
      uploadUrl: ticket.upload_url,
      blob: new Blob([blob], { type: opened.mimeType ?? 'video/mp4' }),
      fileName: item.fileName ?? opened.fileName ?? 'video.mp4',
      signal,
    });

    // Step 3. Only now does a video exist.
    const video = await api.call<DailymotionVideo>({
      url: api.endpoint('/me/videos'),
      method: 'POST',
      accessToken,
      form: this.buildForm(request, accountConfig, fileUrl),
      signal,
    });

    const videoId = video?.id;
    if (!videoId) {
      throw new PlatformError(
        'Dailymotion accepted the upload but created no video',
        ErrorCode.UNKNOWN_OUTCOME,
        { retryable: false },
      );
    }

    const url = video.url ?? watchUrl(videoId);
    const ref: PostRef = { postId: videoId, parts: [{ id: videoId, url }] };

    return {
      // The video exists; nobody can watch it until encoding finishes.
      status: 'processing',
      postId: videoId,
      url,
      parts: ref.parts,
      ref,
      handle: {
        version: 1,
        platform: this.name,
        step: PROCESSING_STEP,
        state: { videoId },
      },
      checkAfterMs: (this.capabilities.asyncProcessing?.pollIntervalSecs ?? 15) * 1000,
      raw: sanitizeVideo(video),
    };
  }

  /** Ask whether an uploaded video has finished encoding. */
  async checkStatus(
    handle: ResumeHandle,
    accountConfig: DailymotionAccountConfig & ResolvedAccountConfig,
    signal?: AbortSignal,
  ): Promise<PlatformStatusResponse> {
    if (handle.platform !== this.name || handle.step !== PROCESSING_STEP) {
      throw new ValidationError(
        `Handle for step "${handle.step}" on "${handle.platform}" is not a Dailymotion processing handle`,
      );
    }
    const videoId = typeof handle.state.videoId === 'string' ? handle.state.videoId : undefined;
    if (!videoId) {
      throw new ValidationError('Dailymotion processing handle carries no videoId');
    }

    const accessToken = await this.accessTokenFor(accountConfig, signal);
    const api = this.apiFor(accountConfig);

    const video = await api.call<DailymotionVideo>({
      url: api.endpoint(`/video/${encodeURIComponent(videoId)}`, {
        fields: 'id,url,status,encoding_progress',
      }),
      method: 'GET',
      accessToken,
      signal,
    });

    if (!video) {
      return {
        status: 'failed',
        postId: videoId,
        error: new PlatformError(
          `Dailymotion no longer knows video ${videoId}; it was removed after upload`,
          ErrorCode.CONTENT_REJECTED,
          { retryable: false },
        ),
      };
    }

    const status = video.status ?? 'processing';
    const url = video.url ?? watchUrl(videoId);

    if (TERMINAL_FAILURE_STATES.has(status)) {
      return {
        status: 'failed',
        postId: videoId,
        error: new PlatformError(
          `Dailymotion refused video ${videoId}: ${status}`,
          ErrorCode.CONTENT_REJECTED,
          { retryable: false, platformCode: status },
        ),
        raw: sanitizeVideo(video),
      };
    }

    if (status === 'published') {
      return {
        status: 'published',
        postId: videoId,
        url,
        ref: { postId: videoId, parts: [{ id: videoId, url }] },
        raw: sanitizeVideo(video),
      };
    }

    return {
      status: 'processing',
      postId: videoId,
      url,
      checkAfterMs: (this.capabilities.asyncProcessing?.pollIntervalSecs ?? 15) * 1000,
      raw: sanitizeVideo(video),
    };
  }

  /** Rules the capability descriptor cannot express. */
  validateExtra(
    request: PostRequest,
    _accountConfig: DailymotionAccountConfig,
    _type: PostType,
  ): Issue[] {
    const issues: Issue[] = [];

    if (request.mode === 'draft') {
      issues.push({
        code: 'DRAFT_UNSUPPORTED',
        field: 'mode',
        message:
          'Dailymotion has no draft: an unpublished video is still uploaded and encoded. Set visibility to "private" if that is what was meant.',
      });
    }

    if (request.scheduledAt !== undefined) {
      issues.push({
        code: 'SCHEDULING_UNSUPPORTED',
        field: 'scheduledAt',
        message: 'Dailymotion has no publish-later endpoint; schedule the job instead',
      });
    }

    return issues;
  }

  private validationHooks(accountConfig: DailymotionAccountConfig): CapabilityValidationOptions {
    return {
      target: undefined,
      validateExtra: (candidate: PostRequest, type: PostType) =>
        this.validateExtra(candidate, accountConfig, type),
    };
  }

  private apiFor(accountConfig: DailymotionAccountConfig): DailymotionApi {
    return new DailymotionApi({
      baseUrl: accountConfig.apiBaseUrl,
      timeoutSeconds: accountConfig.apiTimeoutSeconds,
      fetch: this.fetch,
    });
  }

  /** A token that will still be valid when the upload starts. */
  private async accessTokenFor(
    accountConfig: DailymotionAccountConfig & ResolvedAccountConfig,
    signal?: AbortSignal,
  ): Promise<string> {
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

    const stored = accountConfig.auth.accessToken;
    if (typeof stored !== 'string' || stored.length === 0) {
      throw new PlatformError(
        'This Dailymotion account carries no access token',
        ErrorCode.AUTH_ERROR,
        { retryable: false },
      );
    }
    return stored;
  }

  /** The form `videos.create` takes. */
  private buildForm(
    request: PostRequest,
    accountConfig: DailymotionAccountConfig,
    fileUrl: string,
  ): Record<string, string> {
    const extra = (request.extra ?? {}) as DailymotionExtra;
    const form: Record<string, string> = {
      url: fileUrl,
      title: request.title ?? '',
      // `published` is what makes the video visible; the default is private so
      // that a mis-wired host cannot publish by omission.
      published: String((request.visibility ?? this.capabilities.defaultVisibility) === 'public'),
    };

    const description = request.description ?? request.body;
    if (description !== undefined) {
      form.description = description;
    }
    if (request.tags?.length) {
      form.tags = request.tags.join(',');
    }
    if (request.language !== undefined) {
      form.language = request.language;
    }

    const channel = extra.channel ?? accountConfig.defaultChannel;
    if (channel !== undefined) {
      form.channel = channel;
    }
    if (extra.isCreatedForKids !== undefined) {
      form.is_created_for_kids = String(extra.isCreatedForKids);
    }
    if (extra.isExplicit !== undefined) {
      form.is_explicit = String(extra.isExplicit);
    }
    if (extra.geoblocking?.length) {
      form.geoblocking = extra.geoblocking.join(',');
    }
    if (extra.playerNextVideos?.length) {
      form.player_next_video = extra.playerNextVideos.join(',');
    }

    return form;
  }
}

/** The OAuth2 configuration for one account, built from what the account carries. */
function oauthConfigFor(accountConfig: AccountConfig): OAuth2Config {
  const client = (accountConfig as DailymotionAccountConfig).oauthClient;
  if (!client?.clientId) {
    throw new PlatformError(
      'Refreshing a Dailymotion token needs the account to carry its oauthClient.clientId',
      ErrorCode.AUTH_ERROR,
      { retryable: false },
    );
  }
  return {
    tokenEndpoint: TOKEN_ENDPOINT,
    clientId: client.clientId,
    ...(client.clientSecret === undefined ? {} : { clientSecret: client.clientSecret }),
  };
}

function watchUrl(videoId: string): string {
  return `https://www.dailymotion.com/video/${encodeURIComponent(videoId)}`;
}

/** The parts of a video resource that are safe to hand back and to log. */
function sanitizeVideo(video: DailymotionVideo): JsonValue {
  return {
    id: video.id ?? null,
    url: video.url ?? null,
    status: video.status ?? null,
    encodingProgress: video.encoding_progress ?? null,
  };
}
