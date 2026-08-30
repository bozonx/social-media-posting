import { describe, expect, it } from 'vitest';
import { PostType } from '../src/types/post-type.js';
import { validatePostRequest } from '../src/validation/validate-post-request.js';
import { validateAgainstCapabilities } from '../src/validation/capability-validator.js';
import type { PlatformCapabilities } from '../src/platforms/capabilities.js';
import type { ArticleDocument, PostRequest } from '../src/index.js';

const article: ArticleDocument = {
  title: 'On adding networks',
  blocks: [
    { type: 'heading', level: 2, content: [{ text: 'Why' }] },
    {
      type: 'paragraph',
      content: [
        { text: 'A type system that ' },
        { text: 'fits', marks: ['italic'] },
        { text: ' is cheaper than fifteen refactors.' },
      ],
    },
  ],
};

const articleNetwork: PlatformCapabilities = {
  name: 'article-network',
  postTypes: { [PostType.ARTICLE]: { requiredFields: ['title'] }, [PostType.POST]: {} },
  article: { blocks: ['paragraph', 'heading'], marks: ['bold', 'italic', 'link'], maxBlocks: 50 },
};

const plainNetwork: PlatformCapabilities = {
  name: 'plain-network',
  postTypes: { [PostType.POST]: { requiredFields: ['body'] } },
};

describe('ArticleDocument', () => {
  it('is structurally validated: a document without a title is refused', () => {
    const issues = validatePostRequest({
      platform: 'article-network',
      type: PostType.ARTICLE,
      article: { blocks: article.blocks } as ArticleDocument,
    });
    expect(issues.map(i => i.field)).toContain('article.title');
  });

  it('requires an href on a link mark', () => {
    const issues = validatePostRequest({
      platform: 'article-network',
      type: PostType.ARTICLE,
      article: {
        title: 'T',
        blocks: [{ type: 'paragraph', content: [{ text: 'here', marks: ['link'] }] }],
      },
    });
    expect(issues.map(i => i.field)).toContain('article.blocks[0].content[0].href');
  });

  it('passes on a network that publishes the blocks it uses', () => {
    const validation = validateAgainstCapabilities(
      { platform: 'article-network', type: PostType.ARTICLE, title: 'T', article },
      articleNetwork,
    );
    expect(validation.issues).toEqual([]);
  });

  it('refuses a block the network does not publish, rather than dropping it', () => {
    const validation = validateAgainstCapabilities(
      {
        platform: 'article-network',
        type: PostType.ARTICLE,
        title: 'T',
        article: { ...article, blocks: [...article.blocks, { type: 'code', text: 'x = 1' }] },
      },
      articleNetwork,
    );
    expect(validation.issues.map(i => i.code)).toContain('ARTICLE_BLOCK_UNSUPPORTED');
  });

  it('is unsupported everywhere else, and says so instead of degrading', () => {
    const validation = validateAgainstCapabilities(
      { platform: 'plain-network', type: PostType.ARTICLE, article },
      plainNetwork,
    );
    expect(validation.issues.map(i => i.code)).toContain('POST_TYPE_UNSUPPORTED');
  });

  it("refuses an 'article' document on a post that is not an article", () => {
    const validation = validateAgainstCapabilities(
      { platform: 'article-network', type: PostType.POST, body: 'hi', article },
      articleNetwork,
    );
    expect(validation.issues.map(i => i.code)).toContain('FIELD_FORBIDDEN');
  });
});

describe('thread', () => {
  const threadNetwork: PlatformCapabilities = {
    ...plainNetwork,
    name: 'thread-network',
    maxBodyLength: 300,
    thread: { supported: true, maxSegments: 3, maxSegmentBodyLength: 20 },
  };

  const request = (segments: number, body = 'short'): PostRequest => ({
    platform: 'thread-network',
    body: 'first',
    thread: Array.from({ length: segments }, () => ({ body })),
  });

  it('publishes on a network that declares threads', () => {
    expect(validateAgainstCapabilities(request(2), threadNetwork).issues).toEqual([]);
  });

  it('is refused, not silently flattened, where threads are unsupported', () => {
    const validation = validateAgainstCapabilities(
      { ...request(2), platform: 'plain-network' },
      plainNetwork,
    );
    expect(validation.issues.map(i => i.code)).toContain('THREAD_UNSUPPORTED');
  });

  it('enforces the segment count and per-segment length', () => {
    const tooMany = validateAgainstCapabilities(request(4), threadNetwork);
    expect(tooMany.issues.map(i => i.code)).toContain('TOO_MANY_THREAD_SEGMENTS');

    const tooLong = validateAgainstCapabilities(request(1, 'x'.repeat(40)), threadNetwork);
    expect(tooLong.issues.map(i => i.field)).toContain('thread[0].body');
  });

  it('refuses an empty segment', () => {
    const issues = validatePostRequest({
      platform: 'thread-network',
      body: 'first',
      thread: [{}],
    });
    expect(issues.map(i => i.code)).toContain('EMPTY_THREAD_SEGMENT');
  });
});
