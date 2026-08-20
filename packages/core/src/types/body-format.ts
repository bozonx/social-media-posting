/**
 * Supported body content formats for post text
 * Used for content conversion and platform-specific formatting
 */
export const BodyFormat = {
  /** HTML markup */
  HTML: 'html',
  /** Markdown syntax */
  MARKDOWN: 'md',
  /** Plain text without formatting */
  TEXT: 'text',
} as const;

export type BodyFormat = (typeof BodyFormat)[keyof typeof BodyFormat] | (string & {});
