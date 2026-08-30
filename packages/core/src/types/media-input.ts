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
  /** Known source size used for local capability validation. */
  sizeBytes?: number;
  durationSecs?: number;
  width?: number;
  height?: number;
  /** Container format, lower-case (`mp4`, `mov`, `webm`). Checked only when supplied. */
  container?: string;
  /** Video codec, lower-case (`h264`, `hevc`, `vp9`). Checked only when supplied. */
  videoCodec?: string;
  /** Audio codec, lower-case (`aac`, `opus`). Checked only when supplied. */
  audioCodec?: string;
  /** Frames per second. Checked only when supplied. */
  frameRate?: number;
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
