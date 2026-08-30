import type { MediaInput } from './media-input.js';

/**
 * Inline emphasis a block's text can carry.
 *
 * Deliberately small: every network that publishes long form supports these,
 * and a mark no network shares is a mark that cannot round-trip.
 */
export type InlineMark = 'bold' | 'italic' | 'strike' | 'code' | 'link';

/** A run of text with the marks that apply to it. */
export interface InlineNode {
  text: string;
  marks?: InlineMark[];
  /** Target of a `link` mark. Required when `marks` contains `link`. */
  href?: string;
}

export type ArticleBlockType = 'paragraph' | 'heading' | 'list' | 'quote' | 'code' | 'image';

export interface ParagraphBlock {
  type: 'paragraph';
  content: InlineNode[];
}

export interface HeadingBlock {
  type: 'heading';
  /** 1–6, as in HTML. */
  level: number;
  content: InlineNode[];
}

export interface ListBlock {
  type: 'list';
  ordered?: boolean;
  items: InlineNode[][];
}

export interface QuoteBlock {
  type: 'quote';
  content: InlineNode[];
}

export interface CodeBlock {
  type: 'code';
  /** Verbatim source; never marked up. */
  text: string;
  language?: string;
}

export interface ImageBlock {
  type: 'image';
  media: MediaInput;
  caption?: InlineNode[];
}

export type ArticleBlock =
  ParagraphBlock | HeadingBlock | ListBlock | QuoteBlock | CodeBlock | ImageBlock;

/**
 * A long-form document.
 *
 * `PostType.ARTICLE` requires one: an article is not a long `body` with a
 * `media[]` next to it, and treating it as one is what makes every article
 * network need its own host-side formatter.
 */
export interface ArticleDocument {
  title: string;
  subtitle?: string;
  blocks: ArticleBlock[];
}

/** Block kinds a platform may declare support for. */
export const ARTICLE_BLOCK_TYPES: readonly ArticleBlockType[] = Object.freeze([
  'paragraph',
  'heading',
  'list',
  'quote',
  'code',
  'image',
]);

/** Inline marks a platform may declare support for. */
export const INLINE_MARKS: readonly InlineMark[] = Object.freeze([
  'bold',
  'italic',
  'strike',
  'code',
  'link',
]);
