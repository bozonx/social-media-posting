import { validateAgainstCapabilities, isFieldPresent } from './capability-validator.js';
import { convertBody, countBodyLength, truncateBody, truncateHtml } from '../rendering/body.js';
import { detectItemMediaKind } from '../media/media-priority.js';
import { normalizeTarget } from '../types/target.js';
import type { CapabilityValidationOptions } from './capability-validator.js';
import type { PostRequest } from '../types/post-request.js';
import type { PlatformCapabilities } from '../platforms/capabilities.js';
import type { AdaptedRequest, PreviewResult } from '../types/preview-response.js';
import type { PostType } from '../types/post-type.js';

/**
 * Build a preview from a platform's descriptor alone.
 *
 * @param request - The request to preview.
 * @param capabilities - What the platform accepts.
 * @param options - Platform hooks for rules a descriptor cannot express.
 * @returns The preview the caller sees.
 */
export function previewFromCapabilities(
  request: PostRequest,
  capabilities: PlatformCapabilities,
  options: CapabilityValidationOptions = {},
): PreviewResult {
  const { detectedType, issues, warnings, ignoredFields } = validateAgainstCapabilities(
    request,
    capabilities,
    options,
  );

  const targetFormat = resolveBodyTargetFormat(request, capabilities);
  const { body: convertedBody, truncated } = renderBodyWithTruncation(
    request,
    capabilities,
    targetFormat,
  );

  return {
    success: true,
    data: {
      valid: issues.length === 0,
      detectedType,
      issues,
      warnings,
      ignoredFields,
      convertedBody,
      convertedBodyLength:
        convertedBody !== undefined
          ? countBodyLength(convertedBody, capabilities.bodyLengthRule)
          : undefined,
      targetFormat,
      truncated,
      requiredMediaUrlLifetimeSecs: requiredMediaUrlLifetimeSecs(request, capabilities),
      adaptedRequest: adaptRequest(request, capabilities, detectedType),
    },
  };
}

/**
 * How long the host's signed media URLs must stay alive.
 *
 * Only networks that fetch the bytes themselves care, and only for the media
 * kinds actually present in the request.
 */
export function requiredMediaUrlLifetimeSecs(
  request: PostRequest,
  capabilities: PlatformCapabilities,
): number | undefined {
  const items = [...(request.media ?? []), ...(request.thumbnail ? [request.thumbnail] : [])];
  let longest: number | undefined;

  for (const item of items) {
    if (item.source.kind !== 'url') {
      continue;
    }
    const constraints = capabilities.media?.[detectItemMediaKind(item)];
    if (!constraints || constraints.transport === 'push') {
      continue;
    }
    const secs = constraints.urlMustRemainAvailableForSecs;
    if (secs !== undefined && (longest === undefined || secs > longest)) {
      longest = secs;
    }
  }

  return longest;
}

/**
 * Build the request as the platform will receive it.
 *
 * Deterministic and pure: same inputs, same output, no network call. This is
 * the thing that lets a host delete its per-network formatters.
 *
 * @param request - The caller's request.
 * @param capabilities - What the platform accepts.
 * @param detectedType - The type it publishes as; detected when omitted.
 */
export function adaptRequest(
  request: PostRequest,
  capabilities: PlatformCapabilities,
  detectedType?: PostType,
): AdaptedRequest {
  const type = detectedType ?? validateAgainstCapabilities(request, capabilities).detectedType;
  const targetFormat = resolveBodyTargetFormat(request, capabilities);
  const { body } = renderBodyWithTruncation(request, capabilities, targetFormat);

  const droppedFields = (capabilities.ignoredFields ?? []).filter(field =>
    isFieldPresent(request, field),
  );

  const stripped = { ...request } as Record<string, unknown>;
  for (const field of droppedFields) {
    delete stripped[field];
  }
  const adaptedRequest = stripped as unknown as PostRequest;
  adaptedRequest.type = type;
  adaptedRequest.target = normalizeTarget(request.target);
  adaptedRequest.body = body;
  adaptedRequest.bodyFormat = body === undefined ? undefined : targetFormat;

  const visibility = request.visibility ?? capabilities.defaultVisibility;
  if (visibility !== undefined) {
    adaptedRequest.visibility = visibility;
  }

  return {
    type,
    target: adaptedRequest.target,
    body,
    bodyFormat: adaptedRequest.bodyFormat,
    visibility,
    media: request.media?.map((item, index) => ({
      index,
      kind: detectItemMediaKind(item, type),
      sourceKind: item.source.kind,
      altText: item.altText,
    })),
    droppedFields,
    request: adaptedRequest,
  };
}

/**
 * Convert the body into the platform's canonical format and shorten it to fit,
 * counting length the way that platform counts it, reporting whether truncation occurred.
 */
export function renderBodyWithTruncation(
  request: PostRequest,
  capabilities: PlatformCapabilities,
  targetFormat = capabilities.targetBodyFormat ?? request.bodyFormat ?? 'text',
): { body: string | undefined; truncated: boolean } {
  if (request.body === undefined) {
    return { body: undefined, truncated: false };
  }

  const converted = convertBody(request.body, request.bodyFormat ?? 'text', targetFormat);
  const limit = capabilities.maxBodyLength;

  if (limit === undefined || countBodyLength(converted, capabilities.bodyLengthRule) <= limit) {
    return { body: converted, truncated: false };
  }

  const body =
    targetFormat === 'html'
      ? truncateHtml(converted, limit, capabilities.bodyLengthRule)
      : truncateBody(converted, limit, capabilities.bodyLengthRule);

  return { body, truncated: true };
}

/**
 * Convert the body into the platform's canonical format and shorten it to fit,
 * counting length the way that platform counts it.
 */
export function renderBody(
  request: PostRequest,
  capabilities: PlatformCapabilities,
  targetFormat = capabilities.targetBodyFormat ?? request.bodyFormat ?? 'text',
): string | undefined {
  return renderBodyWithTruncation(request, capabilities, targetFormat).body;
}

/** Resolve the actual wire format, preserving platform-native dialects. */
export function resolveBodyTargetFormat(
  request: PostRequest,
  capabilities: PlatformCapabilities,
): string {
  const input = request.bodyFormat ?? 'text';
  return capabilities.passthroughBodyFormats?.includes(input)
    ? input
    : (capabilities.targetBodyFormat ?? input);
}
