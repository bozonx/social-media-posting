import { validateAgainstCapabilities } from './capability-validator.js';
import { convertBody, countBodyLength, truncateBody, truncateHtml } from '../rendering/body.js';
import type { CapabilityValidationOptions } from './capability-validator.js';
import type { PostRequest } from '../types/post-request.js';
import type { PlatformCapabilities } from '../platforms/capabilities.js';
import type { PreviewResult } from '../types/preview-response.js';

/**
 * Build a preview from a platform's descriptor alone.
 *
 * This is the default `preview()` for every network. A platform only overrides
 * it when the network offers a real dry-run of its own; short of that, a
 * hand-written preview is the same checks written a second time, drifting from
 * the first.
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
  const { detectedType, errors, warnings } = validateAgainstCapabilities(
    request,
    capabilities,
    options,
  );

  if (errors.length > 0) {
    return { success: false, data: { valid: false, errors, warnings } };
  }

  const targetFormat = resolveBodyTargetFormat(request, capabilities);
  const convertedBody = renderBody(request, capabilities, targetFormat);

  return {
    success: true,
    data: {
      valid: true,
      detectedType,
      convertedBody,
      targetFormat,
      convertedBodyLength: convertedBody?.length,
      warnings,
    },
  };
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
  if (request.body === undefined) {
    return undefined;
  }

  const converted = convertBody(request.body, request.bodyFormat ?? 'text', targetFormat);

  const limit =
    capabilities.maxBodyLength === undefined
      ? request.maxBody
      : Math.min(request.maxBody ?? capabilities.maxBodyLength, capabilities.maxBodyLength);

  if (limit === undefined || countBodyLength(converted, capabilities.bodyLengthRule) <= limit) {
    return converted;
  }

  return targetFormat === 'html'
    ? truncateHtml(converted, limit, capabilities.bodyLengthRule)
    : truncateBody(converted, limit, capabilities.bodyLengthRule);
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
