/** How many leading bytes are enough to recognise every signature below. */
export const SNIFF_BYTES = 16;

interface Signature {
  mimeType: string;
  /** Bytes that must match, `null` meaning "any byte". */
  pattern: (number | null)[];
  offset?: number;
}

/**
 * Magic-number signatures for the formats social networks accept.
 *
 * Deliberately not a URL-extension lookup: an extension is a claim by whoever
 * wrote the link, and a `.jpg` that is really an HTML error page is exactly the
 * upload that fails after the bytes have been paid for.
 */
const SIGNATURES: Signature[] = [
  { mimeType: 'image/jpeg', pattern: [0xff, 0xd8, 0xff] },
  { mimeType: 'image/png', pattern: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mimeType: 'image/gif', pattern: [0x47, 0x49, 0x46, 0x38] },
  {
    mimeType: 'image/webp',
    pattern: [0x52, 0x49, 0x46, 0x46, null, null, null, null, 0x57, 0x45, 0x42, 0x50],
  },
  { mimeType: 'video/mp4', pattern: [0x66, 0x74, 0x79, 0x70], offset: 4 },
  { mimeType: 'video/webm', pattern: [0x1a, 0x45, 0xdf, 0xa3] },
  { mimeType: 'audio/mpeg', pattern: [0x49, 0x44, 0x33] },
  { mimeType: 'audio/mpeg', pattern: [0xff, 0xfb] },
  { mimeType: 'audio/ogg', pattern: [0x4f, 0x67, 0x67, 0x53] },
  {
    mimeType: 'audio/wav',
    pattern: [0x52, 0x49, 0x46, 0x46, null, null, null, null, 0x57, 0x41, 0x56, 0x45],
  },
  { mimeType: 'application/pdf', pattern: [0x25, 0x50, 0x44, 0x46] },
];

/**
 * Identify a media type from the first bytes of the file.
 *
 * @param bytes - The leading bytes; {@link SNIFF_BYTES} is always enough.
 * @returns The MIME type, or undefined when nothing matches.
 */
export function sniffMimeType(bytes: Uint8Array): string | undefined {
  for (const { mimeType, pattern, offset = 0 } of SIGNATURES) {
    if (matches(bytes, pattern, offset)) {
      return mimeType;
    }
  }
  return undefined;
}

function matches(bytes: Uint8Array, pattern: (number | null)[], offset: number): boolean {
  if (bytes.length < offset + pattern.length) {
    return false;
  }
  return pattern.every((byte, index) => byte === null || bytes[offset + index] === byte);
}

/** The broad kind of media a MIME type describes. */
export type MediaKind = 'image' | 'video' | 'audio' | 'document';

/**
 * Map a MIME type onto the media kind a capability descriptor is keyed by.
 * @param mimeType - The MIME type, if known.
 */
export function mediaKindOf(mimeType: string | undefined): MediaKind {
  if (mimeType?.startsWith('image/')) {
    return 'image';
  }
  if (mimeType?.startsWith('video/')) {
    return 'video';
  }
  if (mimeType?.startsWith('audio/')) {
    return 'audio';
  }
  return 'document';
}
