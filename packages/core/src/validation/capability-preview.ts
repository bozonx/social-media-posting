import { validateAgainstCapabilities } from './capability-validator.js';
import { convertBody, countBodyLength, truncateBody, truncateHtml } from '../rendering/body.js';
import type { CapabilityValidationOptions } from './capability-validator.js';
import type { PostRequest } from '../types/post-request.js';
import type { PlatformCapabilities } from '../platforms/capabilities.js';
import type { PreviewResult } from '../types/preview-response.js';

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

  if (issues.length > 0) {
    return {
      success: true,
      data: {
        valid: false,
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
      },
    };
  }

  return {
    success: true,
    data: {
      valid: true,
      detectedType,
      issues: [],
      warnings,
      ignoredFields,
      convertedBody,
      convertedBodyLength:
        convertedBody !== undefined
          ? countBodyLength(convertedBody, capabilities.bodyLengthRule)
          : undefined,
      targetFormat,
      truncated,
    },
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
