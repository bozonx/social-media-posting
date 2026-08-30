import { describe, expect, it } from 'vitest';
import { buildFacets, countGraphemes, utf8Length } from '../src/rich-text.js';
describe('Bluesky rich text', () => {
  it('counts grapheme clusters', () => {
    expect(countGraphemes('е\u0308 👨‍👩‍👧‍👦')).toBe(3);
  });
  it('uses UTF-8 byte offsets', async () => {
    const text = 'Привет 👋 https://example.com #тест',
      facets = await buildFacets(text);
    expect(facets).toHaveLength(2);
    expect(facets[0]?.index).toEqual({
      byteStart: utf8Length('Привет 👋 '),
      byteEnd: utf8Length('Привет 👋 https://example.com'),
    });
    expect(
      new TextDecoder().decode(
        new TextEncoder().encode(text).slice(facets[1]?.index.byteStart, facets[1]?.index.byteEnd),
      ),
    ).toBe('#тест');
  });
  it('resolves mentions after emoji', async () => {
    expect((await buildFacets('🙂 @alice.test', async () => 'did:plc:alice'))[0]).toEqual({
      index: { byteStart: 5, byteEnd: 16 },
      features: [{ $type: 'app.bsky.richtext.facet#mention', did: 'did:plc:alice' }],
    });
  });
});
