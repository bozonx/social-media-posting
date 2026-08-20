/**
 * Media type for explicit type specification in media inputs.
 */
export type MediaType = 'image' | 'video' | 'audio' | 'document';

/**
 * A media item to publish alongside or as the post.
 */
export interface MediaInput {
  /** Required whenever the type cannot be safely detected from the source. */
  type?: MediaType;
  /** Accessibility description. Mastodon, Bluesky, X and LinkedIn all take one. */
  altText?: string;
  /** Hide behind a blur/spoiler where the network supports it. */
  sensitive?: boolean;
  fileName?: string;
  mimeType?: string;
  durationSecs?: number;
  width?: number;
  height?: number;
  thumbnail?: ThumbnailInput;
  source: MediaSourceInput;
}

/** A thumbnail cannot recursively contain another thumbnail. */
export type ThumbnailInput = Omit<MediaInput, 'thumbnail' | 'type'> & { type?: 'image' };

export type MediaSourceInput =
  | { kind: 'url'; url: string }
  | { kind: 'bytes'; bytes: Uint8Array }
  | { kind: 'blob'; blob: Blob }
  | { kind: 'stream'; open: MediaStreamFactory; sizeBytes?: number }
  | { kind: 'platformRef'; ref: string };

export type MediaStreamFactory = (options?: {
  /** When supplied, the returned stream must begin exactly at this byte offset. */
  offsetBytes?: number;
  signal?: AbortSignal;
}) => Promise<ReadableStream<Uint8Array>>;
