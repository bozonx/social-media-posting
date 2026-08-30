export interface BlueskyFacet {
  index: { byteStart: number; byteEnd: number };
  features: Array<
    | { $type: 'app.bsky.richtext.facet#link'; uri: string }
    | { $type: 'app.bsky.richtext.facet#tag'; tag: string }
    | { $type: 'app.bsky.richtext.facet#mention'; did: string }
  >;
}
const TOKEN_PATTERN = /https?:\/\/[^\s<>"']+|(?:^|[\s(])([#@])([\p{L}\p{N}_.:-]+)/gu;
export function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
export function countGraphemes(value: string): number {
  return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)].length;
}
export async function buildFacets(
  text: string,
  resolveHandle?: (handle: string) => Promise<string | undefined>,
): Promise<BlueskyFacet[]> {
  const facets: BlueskyFacet[] = [];
  for (const match of text.matchAll(TOKEN_PATTERN)) {
    const whole = match[0],
      prefix = whole.length - whole.trimStart().length;
    const token = whole.slice(prefix).replace(/[.,!?;:)]+$/u, ''),
      start = match.index + prefix;
    const index = {
      byteStart: utf8Length(text.slice(0, start)),
      byteEnd: utf8Length(text.slice(0, start + token.length)),
    };
    if (token.startsWith('http'))
      facets.push({ index, features: [{ $type: 'app.bsky.richtext.facet#link', uri: token }] });
    else if (token.startsWith('#'))
      facets.push({
        index,
        features: [{ $type: 'app.bsky.richtext.facet#tag', tag: token.slice(1) }],
      });
    else if (token.startsWith('@') && resolveHandle) {
      const did = await resolveHandle(token.slice(1));
      if (did)
        facets.push({ index, features: [{ $type: 'app.bsky.richtext.facet#mention', did }] });
    }
  }
  return facets;
}
