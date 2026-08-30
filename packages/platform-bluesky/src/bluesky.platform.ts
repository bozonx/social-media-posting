import {
  ErrorCode,
  PlatformError,
  ValidationError,
  type AccountConfig,
  type CredentialProvider,
  type ILogger,
  type JsonValue,
  type MediaInput,
  type PostRequest,
  type ResolvedAccountConfig,
  type ResumeHandle,
} from '@bozonx/social-posting';
import {
  renderBody,
  toMediaSource,
  validateAgainstCapabilities,
} from '@bozonx/social-posting/platform';
import type {
  IPlatform,
  PlatformPublishResponse,
  PlatformStatusResponse,
  PublishOptions,
} from '@bozonx/social-posting/platform';
import { blueskyCapabilities } from './capabilities.js';
import { buildFacets } from './rich-text.js';
type Json = Record<string, unknown>;
type StrongRef = { uri: string; cid: string };
export interface BlueskyAccountConfig extends AccountConfig {
  auth: AccountConfig['auth'] & { accessToken?: string; refreshToken?: string; did?: string };
}
export interface BlueskyPlatformDeps {
  logger: ILogger;
  credentialProvider?: CredentialProvider;
  fetch?: typeof fetch;
}
const VIDEO_SERVICE = 'https://video.bsky.app',
  VIDEO_AUDIENCE = 'did:web:video.bsky.app';

export class BlueskyPlatform implements IPlatform {
  readonly name = 'bluesky';
  readonly capabilities = blueskyCapabilities;
  constructor(private readonly deps: BlueskyPlatformDeps) {}
  async publish(
    request: PostRequest,
    account: BlueskyAccountConfig & ResolvedAccountConfig,
    options?: PublishOptions,
  ): Promise<PlatformPublishResponse> {
    if (options?.signal?.aborted)
      throw new PlatformError('Request aborted before publishing', ErrorCode.NETWORK_ERROR, {
        retryable: false,
      });
    const capabilities = options?.capabilities ?? this.capabilities,
      checked = validateAgainstCapabilities(request, capabilities, { target: account.target });
    if (checked.issues.length) throw new ValidationError(checked.issues);
    const base = baseOf(account),
      did = required(account.auth.did, 'Bluesky requires the account DID');
    let token = required(account.auth.accessToken, 'Bluesky requires an access token');
    let parent = replyRef(request),
      root = parent?.root ?? parent?.parent,
      last: StrongRef | undefined;
    const segments = [{ body: request.body, media: request.media }, ...(request.thread ?? [])];
    for (const [index, segment] of segments.entries()) {
      const text =
        renderBody(
          { ...request, body: segment.body, media: segment.media, thread: undefined },
          capabilities,
        ) ?? '';
      const record: Json = {
        $type: 'app.bsky.feed.post',
        text,
        createdAt: new Date().toISOString(),
        facets: await buildFacets(text, handle =>
          this.resolveHandle(base, handle, options?.signal),
        ),
        ...(request.language ? { langs: [request.language] } : {}),
        ...(parent ? { reply: { root: root ?? parent.parent, parent: parent.parent } } : {}),
      };
      const media = segment.media ?? [];
      if (media[0]?.type === 'video') {
        const processing = await this.startVideo(
          base,
          did,
          token,
          media[0],
          record,
          options?.signal,
        );
        if (processing) return processing;
      } else if (media.length)
        record.embed = {
          $type: 'app.bsky.embed.images',
          images: await Promise.all(
            media.map(item => this.uploadImage(base, token, item, options?.signal)),
          ),
        };
      const created = await this.createRecord(base, token, did, record, account, options?.signal);
      token = created.token;
      last = created.ref;
      parent = { parent: last, root: root ?? last };
      root ??= last;
      this.deps.logger.log(`Published ${last.uri} (segment ${index + 1})`, 'BlueskyPlatform');
    }
    if (!last)
      throw new PlatformError('Bluesky returned no record', ErrorCode.UNKNOWN_OUTCOME, {
        retryable: false,
      });
    return published(last);
  }
  async checkStatus(
    handle: ResumeHandle,
    account: BlueskyAccountConfig & ResolvedAccountConfig,
    signal?: AbortSignal,
  ): Promise<PlatformStatusResponse> {
    if (handle.platform !== 'bluesky' || handle.version !== 1 || handle.step !== 'videoProcessing')
      throw new ValidationError('Invalid Bluesky video handle');
    const jobId = requiredString(handle.state.jobId, 'video job id'),
      did = requiredString(handle.state.did, 'DID'),
      base = baseOf(account),
      token = required(account.auth.accessToken, 'Bluesky requires an access token');
    const serviceToken = await this.serviceToken(
        base,
        token,
        'app.bsky.video.getJobStatus',
        signal,
      ),
      status = await this.call(
        `${VIDEO_SERVICE}/xrpc/app.bsky.video.getJobStatus?jobId=${encodeURIComponent(jobId)}`,
        serviceToken,
        { method: 'GET', signal },
      ),
      job = objectOf(status.jobStatus ?? status);
    if (job.state === 'JOB_STATE_FAILED')
      return {
        status: 'failed',
        error: new PlatformError(
          optionalString(job.message) ?? 'Bluesky video processing failed',
          ErrorCode.CONTENT_REJECTED,
          { retryable: false },
        ),
        raw: status as JsonValue,
      };
    const blob = objectOf(job.blob);
    if (!blob.ref) return { status: 'processing', checkAfterMs: 5_000, raw: status as JsonValue };
    const record = objectOf(handle.state.record);
    record.embed = {
      $type: 'app.bsky.embed.video',
      video: blob,
      ...(handle.state.alt ? { alt: handle.state.alt } : {}),
    };
    const created = await this.createRecord(base, token, did, record, account, signal);
    return {
      status: 'published',
      postId: created.ref.uri,
      url: postUrl(did, created.ref.uri),
      ref: { postId: created.ref.uri, extra: { cid: created.ref.cid } },
      raw: status as JsonValue,
    };
  }
  private async startVideo(
    base: string,
    did: string,
    token: string,
    media: MediaInput,
    record: Json,
    signal?: AbortSignal,
  ): Promise<PlatformPublishResponse | undefined> {
    const bytes = await this.readMedia(media, signal),
      serviceToken = await this.serviceToken(base, token, 'app.bsky.video.uploadVideo', signal),
      name = media.fileName ?? `video-${Date.now()}.mp4`;
    const result = await this.call(
        `${VIDEO_SERVICE}/xrpc/app.bsky.video.uploadVideo?did=${encodeURIComponent(did)}&name=${encodeURIComponent(name)}`,
        serviceToken,
        {
          method: 'POST',
          body: new Blob([bytes as unknown as BlobPart]),
          contentType: media.mimeType ?? 'video/mp4',
          signal,
        },
      ),
      job = objectOf(result.jobStatus ?? result),
      blob = objectOf(job.blob);
    if (blob.ref) {
      record.embed = {
        $type: 'app.bsky.embed.video',
        video: blob,
        ...(media.altText ? { alt: media.altText } : {}),
      };
      return undefined;
    }
    return {
      status: 'processing',
      handle: {
        version: 1,
        platform: 'bluesky',
        step: 'videoProcessing',
        state: {
          jobId: requiredString(job.jobId, 'video job id'),
          did,
          record: record as JsonValue,
          ...(media.altText ? { alt: media.altText } : {}),
        },
      },
      checkAfterMs: 5_000,
      raw: result,
    };
  }
  private async uploadImage(
    base: string,
    token: string,
    media: MediaInput,
    signal?: AbortSignal,
  ): Promise<Json> {
    const bytes = await this.readMedia(media, signal);
    const result = await this.call(`${base}/xrpc/com.atproto.repo.uploadBlob`, token, {
      method: 'POST',
      body: new Blob([bytes as unknown as BlobPart]),
      contentType: media.mimeType ?? 'application/octet-stream',
      signal,
    });
    return { alt: media.altText ?? '', image: objectOf(result.blob) };
  }
  private async readMedia(media: MediaInput, signal?: AbortSignal): Promise<Uint8Array> {
    const source = toMediaSource(media);
    if (source.kind === 'platformRef')
      throw new ValidationError('Bluesky media references are not reusable');
    if (source.kind === 'bytes') return source.bytes;
    if (source.kind === 'blob') return new Uint8Array(await source.blob.arrayBuffer());
    const response =
      source.kind === 'url'
        ? await (this.deps.fetch ?? fetch)(source.url, { signal })
        : new Response(await source.open({ signal }));
    if (!response.ok)
      throw new PlatformError('Could not read Bluesky media', ErrorCode.NETWORK_ERROR, {
        retryable: true,
        httpStatus: response.status,
      });
    return new Uint8Array(await response.arrayBuffer());
  }
  private async createRecord(
    base: string,
    token: string,
    did: string,
    record: Json,
    account: BlueskyAccountConfig & ResolvedAccountConfig,
    signal?: AbortSignal,
  ): Promise<{ ref: StrongRef; token: string }> {
    const invoke = (access: string) =>
      this.call(`${base}/xrpc/com.atproto.repo.createRecord`, access, {
        method: 'POST',
        json: { repo: did, collection: 'app.bsky.feed.post', record },
        signal,
      });
    let result: Json;
    try {
      result = await invoke(token);
    } catch (error) {
      if (!(error instanceof PlatformError) || error.httpStatus !== 401) throw error;
      token = await this.refreshSession(base, account, signal);
      result = await invoke(token);
    }
    return {
      ref: {
        uri: requiredString(result.uri, 'record URI'),
        cid: requiredString(result.cid, 'record CID'),
      },
      token,
    };
  }
  private async refreshSession(
    base: string,
    account: BlueskyAccountConfig & ResolvedAccountConfig,
    signal?: AbortSignal,
  ): Promise<string> {
    const refresh = required(account.auth.refreshToken, 'Bluesky requires a refresh token');
    const result = await this.call(`${base}/xrpc/com.atproto.server.refreshSession`, refresh, {
      method: 'POST',
      signal,
    });
    const accessToken = requiredString(result.accessJwt, 'access JWT'),
      refreshToken = requiredString(result.refreshJwt, 'refresh JWT');
    if (!account.accountRef || !this.deps.credentialProvider?.onCredentialsRefreshed)
      throw new PlatformError(
        'Bluesky rotated the session but the host cannot persist it',
        ErrorCode.AUTH_REFRESH_REQUIRED,
        { retryable: false },
      );
    await this.deps.credentialProvider.onCredentialsRefreshed(account.accountRef, {
      ...account.auth,
      accessToken,
      refreshToken,
      did: result.did ?? account.auth.did,
    });
    return accessToken;
  }
  private async serviceToken(
    base: string,
    token: string,
    method: 'app.bsky.video.uploadVideo' | 'app.bsky.video.getJobStatus',
    signal?: AbortSignal,
  ): Promise<string> {
    const url = `${base}/xrpc/com.atproto.server.getServiceAuth?aud=${encodeURIComponent(VIDEO_AUDIENCE)}&lxm=${encodeURIComponent(method)}`;
    return requiredString(
      (await this.call(url, token, { method: 'GET', signal })).token,
      'video service token',
    );
  }
  private async resolveHandle(
    base: string,
    handle: string,
    signal?: AbortSignal,
  ): Promise<string | undefined> {
    const response = await (this.deps.fetch ?? fetch)(
      `${base}/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`,
      { signal },
    );
    if (!response.ok) return undefined;
    return optionalString(((await response.json()) as Json).did);
  }
  private async call(
    url: string,
    token: string,
    init: {
      method: string;
      json?: Json;
      body?: BodyInit;
      contentType?: string;
      signal?: AbortSignal;
    },
  ): Promise<Json> {
    if (init.signal?.aborted)
      throw new PlatformError('Bluesky request aborted', ErrorCode.NETWORK_ERROR, {
        retryable: false,
      });
    let response: Response;
    try {
      response = await (this.deps.fetch ?? fetch)(url, {
        method: init.method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(init.json || init.contentType
            ? { 'content-type': init.contentType ?? 'application/json' }
            : {}),
        },
        body: init.json ? JSON.stringify(init.json) : init.body,
        signal: init.signal,
      });
    } catch (cause) {
      throw new PlatformError('Bluesky request failed', ErrorCode.NETWORK_ERROR, {
        retryable: true,
        cause,
      });
    }
    const raw = (await response.json().catch(() => ({}))) as Json;
    if (!response.ok) {
      const retry = Number(response.headers.get('retry-after'));
      throw new PlatformError(
        optionalString(raw.message) ?? `Bluesky API returned ${response.status}`,
        response.status === 401 || response.status === 403
          ? ErrorCode.AUTH_REFRESH_REQUIRED
          : response.status === 429
            ? ErrorCode.RATE_LIMIT_ERROR
            : ErrorCode.PLATFORM_ERROR,
        {
          httpStatus: response.status,
          platformCode: optionalString(raw.error),
          retryable: response.status === 429 || response.status >= 500,
          retryAfterMs: Number.isFinite(retry) ? retry * 1000 : undefined,
          raw,
        },
      );
    }
    return raw;
  }
}
function baseOf(account: ResolvedAccountConfig): string {
  if (!account.apiBaseUrl) throw new ValidationError('Bluesky requires apiBaseUrl');
  return account.apiBaseUrl.replace(/\/+$/, '');
}
function required(value: unknown, message: string): string {
  if (typeof value !== 'string' || !value) throw new ValidationError(message);
  return value;
}
function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value)
    throw new PlatformError(`Bluesky returned no ${label}`, ErrorCode.UNKNOWN_OUTCOME, {
      retryable: false,
    });
  return value;
}
function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}
function objectOf(value: unknown): Json {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {};
}
function postUrl(did: string, uri: string): string {
  return `https://bsky.app/profile/${did}/post/${uri.slice(uri.lastIndexOf('/') + 1)}`;
}
function published(ref: StrongRef): PlatformPublishResponse {
  const did = ref.uri.split('/')[2] ?? '';
  return {
    status: 'published',
    postId: ref.uri,
    url: postUrl(did, ref.uri),
    ref: { postId: ref.uri, extra: { cid: ref.cid } },
  };
}
function replyRef(request: PostRequest): { parent: StrongRef; root?: StrongRef } | undefined {
  if (!request.inReplyTo) return undefined;
  const cid = request.inReplyTo.extra?.cid,
    rootUri = request.inReplyTo.extra?.rootUri,
    rootCid = request.inReplyTo.extra?.rootCid;
  if (typeof cid !== 'string')
    throw new ValidationError('Bluesky replies require inReplyTo.extra.cid');
  return {
    parent: { uri: request.inReplyTo.id, cid },
    ...(typeof rootUri === 'string' && typeof rootCid === 'string'
      ? { root: { uri: rootUri, cid: rootCid } }
      : {}),
  };
}
