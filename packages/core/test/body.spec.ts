import { describe, expect, it } from 'vitest';
import {
  convertBody,
  countBodyLength,
  escapeHtml,
  escapeMarkdownV2,
  htmlToPlainText,
  markdownToHtml,
  markdownToPlainText,
  truncateBody,
} from '../src/rendering/body.js';

describe('countBodyLength', () => {
  it('counts characters when the platform states no URL rule', () => {
    expect(countBodyLength('hello')).toBe(5);
  });

  it('charges every URL a fixed weight when the platform shortens links', () => {
    const url = `https://example.com/${'x'.repeat(100)}`;

    // 'see ' is 4 characters, and the URL counts as 23 however long it is.
    expect(countBodyLength(`see ${url}`, { urlWeight: 23 })).toBe(27);
  });

  it('can make a short-looking body count as longer', () => {
    expect(countBodyLength('https://a.io', { urlWeight: 23 })).toBe(23);
  });
});

describe('truncateBody', () => {
  it('leaves a body that already fits', () => {
    expect(truncateBody('short', 10)).toBe('short');
  });

  it('cuts at a word boundary and marks the cut', () => {
    const result = truncateBody('one two three four five', 12);

    expect(result.endsWith('…')).toBe(true);
    expect(result.length).toBeLessThanOrEqual(12);
    expect(result).not.toContain('thre…');
  });

  it('respects the platform URL weighting when cutting', () => {
    const body = `text https://example.com/${'y'.repeat(80)} more`;
    const result = truncateBody(body, 30, { urlWeight: 23 });

    expect(countBodyLength(result, { urlWeight: 23 })).toBeLessThanOrEqual(30);
  });
});

describe('escaping', () => {
  it('escapes HTML metacharacters', () => {
    expect(escapeHtml('<a href="x">&</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
  });

  it('escapes every character MarkdownV2 reserves', () => {
    expect(escapeMarkdownV2('a_b*c[d]e.f!')).toBe('a\\_b\\*c\\[d\\]e\\.f\\!');
  });
});

describe('convertBody', () => {
  it('returns the body unchanged when the formats match', () => {
    expect(convertBody('<b>x</b>', 'html', 'html')).toBe('<b>x</b>');
  });

  it('escapes text on the way into HTML', () => {
    expect(convertBody('5 < 6', 'text', 'html')).toBe('5 &lt; 6');
  });

  it('strips tags on the way out of HTML', () => {
    expect(convertBody('<p>one</p><p>two</p>', 'html', 'text')).toBe('one\n\ntwo');
  });

  it('renders the shared Markdown subset as HTML', () => {
    expect(convertBody('**bold** and *italic* and `code`', 'md', 'html')).toBe(
      '<b>bold</b> and <i>italic</i> and <code>code</code>',
    );
  });

  it('renders a Markdown link as an anchor', () => {
    expect(markdownToHtml('[docs](https://example.com)')).toBe(
      '<a href="https://example.com">docs</a>',
    );
  });

  it('flattens Markdown to readable plain text', () => {
    expect(markdownToPlainText('**bold** [docs](https://example.com)')).toBe(
      'bold docs (https://example.com)',
    );
  });

  it('passes a platform dialect through untouched', () => {
    // A platform that declares 'MarkdownV2' as an input format already receives
    // it in the form it wants; guessing at a conversion would corrupt it.
    expect(convertBody('*hi*', 'MarkdownV2', 'text')).toBe('*hi*');
  });

  it('decodes the entities its own escaper produced', () => {
    expect(htmlToPlainText(escapeHtml('a & b < c'))).toBe('a & b < c');
  });
});
