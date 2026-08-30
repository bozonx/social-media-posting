import { BodyFormat } from '../types/body-format.js';
import type { BodyLengthRule } from '../platforms/capabilities.js';

const URL_PATTERN = /https?:\/\/\S+/g;

/**
 * Count a body the way a platform counts it.
 *
 * Networks that shorten links charge every URL a fixed number of characters
 * regardless of its real length — X counts 23 — so a body that looks 400
 * characters long can be over the limit, or under it.
 *
 * @param body - The body text.
 * @param rule - How this platform counts; plain character count when omitted.
 * @returns The length the platform will see.
 */
export function countBodyLength(body: string, rule?: BodyLengthRule): number {
  const unitsOf = (text: string): number => countUnits(text, rule?.countUnit);

  if (!rule?.urlWeight) {
    return unitsOf(body);
  }

  let length = unitsOf(body);
  for (const match of body.matchAll(URL_PATTERN)) {
    length += rule.urlWeight - unitsOf(match[0]);
  }
  return length;
}

/** Segmenter is expensive to build and stateless once built. */
let graphemeSegmenter: Intl.Segmenter | undefined;

/**
 * Length of a string in the unit a platform counts in.
 *
 * @param text - The text to measure.
 * @param unit - The platform's unit; `utf16` when unstated.
 */
export function countUnits(text: string, unit: BodyLengthRule['countUnit'] = 'utf16'): number {
  if (unit === 'utf8Bytes') {
    return new TextEncoder().encode(text).length;
  }
  if (unit === 'graphemes') {
    if (typeof Intl.Segmenter === 'function') {
      graphemeSegmenter ??= new Intl.Segmenter(undefined, { granularity: 'grapheme' });
      let count = 0;
      for (const _ of graphemeSegmenter.segment(text)) {
        count += 1;
      }
      return count;
    }
    // Without Intl.Segmenter, code points are closer than UTF-16 units: it
    // still counts an emoji as one where the pair would have counted two.
    return [...text].length;
  }
  return text.length;
}

/**
 * Shorten a body to fit a platform's limit, cutting at a word boundary and
 * appending an ellipsis.
 *
 * @param body - The body text.
 * @param maxLength - The platform's limit, counted by `rule`.
 * @param rule - How this platform counts.
 * @returns The body unchanged when it already fits, otherwise a shortened one.
 */
export function truncateBody(body: string, maxLength: number, rule?: BodyLengthRule): string {
  if (countBodyLength(body, rule) <= maxLength) {
    return body;
  }

  const ellipsis = '…';
  let candidate = body.slice(0, Math.max(0, maxLength - 1));

  // A URL that survived the cut may be counted as longer than it looks, so
  // shrink until the platform's own count fits.
  while (candidate.length > 0 && countBodyLength(candidate + ellipsis, rule) > maxLength) {
    candidate = candidate.slice(0, -1);
  }

  const lastSpace = candidate.lastIndexOf(' ');
  if (lastSpace > candidate.length * 0.6) {
    candidate = candidate.slice(0, lastSpace);
  }

  return candidate.trimEnd() + ellipsis;
}

/** Shorten generated HTML without splitting entities or leaving tags open. */
export function truncateHtml(body: string, maxLength: number, rule?: BodyLengthRule): string {
  if (countBodyLength(body, rule) <= maxLength) return body;

  const ellipsis = '…';
  const tokens = body.match(/<[^>]*>|&(?:#\d+|#x[\da-f]+|[a-z]+);|[^<&]+|[<&]/gi) ?? [];
  const output: string[] = [];
  const openTags: string[] = [];
  const closingTags = () =>
    openTags
      .map(tag => `</${tag}>`)
      .reverse()
      .join('');
  const fits = (part: string) =>
    countBodyLength(output.join('') + part + ellipsis + closingTags(), rule) <= maxLength;

  for (const token of tokens) {
    const opening = token.match(/^<([a-z][\w-]*)(?:\s[^>]*)?>$/i);
    const closing = token.match(/^<\/([a-z][\w-]*)\s*>$/i);
    if (opening?.[1]) {
      if (!fits(token)) break;
      output.push(token);
      openTags.push(opening[1].toLowerCase());
      continue;
    }
    if (closing?.[1]) {
      if (!fits(token)) break;
      output.push(token);
      const index = openTags.lastIndexOf(closing[1].toLowerCase());
      if (index >= 0) openTags.splice(index, 1);
      continue;
    }
    for (const character of token) {
      if (!fits(character)) return output.join('') + ellipsis + closingTags();
      output.push(character);
    }
  }
  return output.join('') + ellipsis + closingTags();
}

/** Escape text so it is safe inside the HTML subset the platforms accept. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Escape text for Telegram's MarkdownV2, which reserves a long list of characters. */
export function escapeMarkdownV2(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, character => `\\${character}`);
}

/** Strip HTML tags and decode the entities the escaper produces. */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .trim();
}

/** Convert the Markdown subset every network agrees on into that HTML subset. */
export function markdownToHtml(markdown: string): string {
  return escapeHtml(markdown)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/(?<!\*)\*(?!\s)(.+?)(?<!\s)\*(?!\*)/g, '<i>$1</i>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, text: string, href: string) => {
      try {
        const url = new URL(href);
        return url.protocol === 'http:' || url.protocol === 'https:'
          ? `<a href="${href}">${text}</a>`
          : text;
      } catch {
        return text;
      }
    });
}

/** Strip Markdown syntax, leaving the text a reader would see. */
export function markdownToPlainText(markdown: string): string {
  return markdown
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/(?<!\*)\*(?!\s)(.+?)(?<!\s)\*(?!\*)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .trim();
}

/**
 * Convert a body between the formats the library knows.
 *
 * A format the library does not know — a platform dialect such as Telegram's
 * `MarkdownV2` — is passed through untouched: the platform declared it as an
 * accepted input format, so it is already in the form that platform wants.
 *
 * @param body - The body text.
 * @param from - The format the caller sent.
 * @param to - The format the platform wants.
 * @returns The converted body.
 */
export function convertBody(body: string, from: string, to: string): string {
  if (from === to) {
    return body;
  }

  const known = new Set<string>([BodyFormat.TEXT, BodyFormat.HTML, BodyFormat.MARKDOWN]);
  if (!known.has(from) || !known.has(to)) {
    return body;
  }

  if (to === (BodyFormat.TEXT as string)) {
    return from === (BodyFormat.HTML as string) ? htmlToPlainText(body) : markdownToPlainText(body);
  }

  if (to === (BodyFormat.HTML as string)) {
    return from === (BodyFormat.MARKDOWN as string) ? markdownToHtml(body) : escapeHtml(body);
  }

  // Converting *into* Markdown would have to guess at the author's intent, so
  // the text is emitted literally with its Markdown characters escaped.
  return from === (BodyFormat.HTML as string) ? htmlToPlainText(body) : escapeMarkdownV2(body);
}
